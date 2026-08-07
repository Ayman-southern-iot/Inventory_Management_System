import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  APPROVER_SLOT_NUMBERS,
  AUDIT_ALWAYS_ON_ACTIONS,
  AUDIT_ACTIONS,
  AUDIT_RETENTION_PRESETS,
  Role,
  SettingKey,
  getSettingDefinition,
  isSettingKey,
  type ApproverSlot,
  type AuditAction,
  type Setting,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { Checkbox, SelectField, TextField } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { LoadingState, QueryBoundary } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { cn } from '@/lib/cn';
import { useApproverSlots, useSetApproverSlot, useSettings, useUpdateSetting, useUsers } from '../api';

const APPROVER_QUERY = { page: 1, limit: 100, includeInactive: false, role: Role.APPROVER } as const;

/** The registry drives the label, so adding a setting needs no change here. */
function labelFor(key: SettingKey): string {
  const labelKey = getSettingDefinition(key).labelKey as keyof typeof t.settings;
  const label = t.settings[labelKey];
  return typeof label === 'string' ? label : key;
}

/**
 * Friendly form of a dotted audit action id (`auth.login.failure` → "Auth login failure").
 * The dotted path groups naturally on the prefix boundary.
 */
function humaniseActionId(action: AuditAction): string {
  return action
    .split('.')
    .map((segment) =>
      segment
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (char) => char.toUpperCase()),
    )
    .join(' › ');
}

/** Footer copy shared by every settings row. */
function LastChangedFooter({ setting }: { setting: Setting }) {
  return (
    <p className="text-xs text-ink-subtle">
      {setting.updatedByName
        ? `${t.settings.lastChanged} ${t.settings.by} ${setting.updatedByName}`
        : t.settings.never}
    </p>
  );
}

interface SaveableSettingRowProps {
  setting: Setting;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  /** Field column content — each row's own control goes here. */
  children: ReactNode;
}

/** Visual frame shared by every setting row (label column + save button + footer). */
function SaveableSettingRow({ setting, isDirty, isSaving, onSave, children }: SaveableSettingRowProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="min-w-56 flex-1">{children}</div>
      <div className="flex items-center gap-3 pb-2.5">
        <Button size="sm" disabled={!isDirty} isLoading={isSaving} onClick={() => void onSave()}>
          {t.common.save}
        </Button>
        <LastChangedFooter setting={setting} />
      </div>
    </div>
  );
}

function NumericSettingRow({ setting }: { setting: Setting }) {
  const toast = useToast();
  const updateSetting = useUpdateSetting();
  const [draft, setDraft] = useState(String(setting.value ?? ''));

  useEffect(() => setDraft(String(setting.value ?? '')), [setting.value]);

  const isDirty = draft !== String(setting.value ?? '');

  async function save() {
    if (!isSettingKey(setting.key)) return;
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      toast.error(t.errors.VALIDATION_FAILED);
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: setting.key, value: parsed });
      toast.success(t.settings.saved);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <SaveableSettingRow
      setting={setting}
      isDirty={isDirty}
      isSaving={updateSetting.isPending}
      onSave={save}
    >
      <TextField
        label={labelFor(setting.key)}
        type="number"
        inputMode="numeric"
        hint={
          setting.key === 'EXPENSE_THRESHOLD_BDT' ? t.settings.expenseThresholdHint : undefined
        }
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </SaveableSettingRow>
  );
}

/**
 * Retention is shown as a dropdown so the persisted day count always matches a label. The
 * presets live in the shared registry; the UI only maps them to <option> children.
 */
function AuditRetentionSetting({ setting }: { setting: Setting }) {
  const toast = useToast();
  const updateSetting = useUpdateSetting();

  const stored = typeof setting.value === 'number' ? setting.value : 0;
  const [draft, setDraft] = useState<string>(String(stored));

  useEffect(() => setDraft(String(stored)), [stored]);

  const isDirty = Number(draft) !== stored;

  async function save() {
    if (!isSettingKey(setting.key)) return;
    const parsed = Number(draft);
    try {
      await updateSetting.mutateAsync({ key: setting.key, value: parsed });
      toast.success(t.settings.saved);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <SaveableSettingRow
      setting={setting}
      isDirty={isDirty}
      isSaving={updateSetting.isPending}
      onSave={save}
    >
      <SelectField
        label={labelFor(setting.key)}
        hint={t.settings.auditRetentionDaysHint}
        value={draft}
        disabled={updateSetting.isPending}
        onChange={(event) => setDraft(event.target.value)}
      >
        {AUDIT_RETENTION_PRESETS.map((preset) => (
          <option key={preset.days} value={String(preset.days)}>
            {preset.days === 0 ? t.settings.auditRetentionForever : preset.label}
          </option>
        ))}
      </SelectField>
    </SaveableSettingRow>
  );
}

/**
 * Audit enabled actions — a custom multi-select dropdown so the trigger can summarise the
 * selection count without giving up the keyboard semantics of a real listbox.
 *
 * Always-on actions render as permanently checked and disabled; the API refuses to drop them
 * anyway (SettingsService throws) but rendering them disabled prevents the UI from inviting a
 * save that would 400.
 */
function AuditActionsSetting({ setting }: { setting: Setting }) {
  const toast = useToast();
  const updateSetting = useUpdateSetting();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const initial = useMemo(() => {
    const stored = setting.value;
    if (Array.isArray(stored)) {
      return new Set<AuditAction>(
        stored.filter((value): value is AuditAction =>
          (AUDIT_ACTIONS as readonly string[]).includes(value),
        ),
      );
    }
    return new Set<AuditAction>([...AUDIT_ALWAYS_ON_ACTIONS]);
  }, [setting.value]);

  const [draft, setDraft] = useState<Set<AuditAction>>(initial);
  const [open, setOpen] = useState(false);

  useEffect(() => setDraft(initial), [initial]);

  const isDirty = useMemo(() => {
    if (draft.size !== initial.size) return true;
    for (const action of draft) if (!initial.has(action)) return true;
    return false;
  }, [draft, initial]);

  // Close on outside click so the trigger alone is enough to dismiss.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function save() {
    if (!isSettingKey(setting.key)) return;
    try {
      await updateSetting.mutateAsync({ key: setting.key, value: [...draft] });
      toast.success(t.settings.saved);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  function toggle(action: AuditAction, enabled: boolean) {
    setDraft((previous) => {
      const next = new Set(previous);
      if (enabled) next.add(action);
      else next.delete(action);
      return next;
    });
  }

  function selectAll() {
    setDraft(new Set(AUDIT_ACTIONS));
  }

  function clearOptional() {
    setDraft(new Set(AUDIT_ALWAYS_ON_ACTIONS));
  }

  const triggerId = `audit-actions-trigger-${setting.key}`;
  const listboxId = `audit-actions-listbox-${setting.key}`;
  const totalActions = AUDIT_ACTIONS.length;

  return (
    <SaveableSettingRow
      setting={setting}
      isDirty={isDirty}
      isSaving={updateSetting.isPending}
      onSave={save}
    >
      <div ref={containerRef} className="relative">
        <button
          id={triggerId}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((value) => !value)}
          disabled={updateSetting.isPending}
          className={cn(
            'flex w-full items-center justify-between rounded-[--radius-control] border border-border bg-surface px-3 text-sm text-ink',
            'h-10 disabled:bg-surface-muted disabled:text-ink-subtle',
          )}
        >
          <span>{t.settings.auditActionsSelectedSummary(draft.size, totalActions)}</span>
          <span aria-hidden="true" className="text-ink-subtle">
            ▾
          </span>
        </button>

        {open ? (
          <div
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-labelledby={triggerId}
            className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-[--radius-control] border border-border bg-surface shadow-[--shadow-panel]"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={selectAll}
              >
                {t.settings.auditSelectAll}
              </button>
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={clearOptional}
              >
                {t.settings.auditClearOptional}
              </button>
            </div>
            <ul className="divide-y divide-border">
              {AUDIT_ACTIONS.map((action) => {
                const isAlwaysOn = (AUDIT_ALWAYS_ON_ACTIONS as readonly AuditAction[]).includes(action);
                const checked = draft.has(action) || isAlwaysOn;
                return (
                  <li key={action}>
                    <div
                      className={cn(
                        'flex items-start gap-3 px-3 py-2 text-sm hover:bg-surface-2',
                        isAlwaysOn && 'cursor-not-allowed opacity-90',
                      )}
                    >
                      <Checkbox
                        label={humaniseActionId(action)}
                        checked={checked}
                        disabled={isAlwaysOn}
                        onChange={(event) => toggle(action, event.target.checked)}
                      />
                      <span className="flex flex-1 flex-col">
                        <span className="font-mono text-[0.7rem] text-ink-subtle">{action}</span>
                        {isAlwaysOn ? (
                          <span className="text-[0.7rem] text-ink-subtle">
                            {t.settings.auditAlwaysOnHint}
                          </span>
                        ) : null}
                      </span>
                      {isAlwaysOn ? (
                        <span className="ml-auto rounded-full bg-surface-muted px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-ink-subtle">
                          {t.settings.auditAlwaysOn}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <p className="mt-1.5 text-xs text-ink-subtle">{t.settings.auditEnabledActionsHint}</p>
      </div>
    </SaveableSettingRow>
  );
}

/**
 * The single admin-designated approver for sub-threshold requisitions. Distinct from the
 * `approver_slots` chain above because sub-threshold only ever needs one approver, and
 * letting it share slot 1 with the at-or-above chain was confusing when an admin
 * reassigned slot 1 (Phase 05).
 */
function SubthresholdApproverSetting({
  setting,
  approvers,
}: {
  setting: Setting;
  approvers: { id: string; fullName: string }[];
}) {
  const toast = useToast();
  const updateSetting = useUpdateSetting();

  const initial = (setting.value as string | null) ?? '';
  const [draft, setDraft] = useState(initial);

  useEffect(() => setDraft(initial), [initial]);

  const isDirty = draft !== initial;

  async function save() {
    if (!isSettingKey(setting.key)) return;
    // Send null when cleared; the API's zod schema coerces "" → null too, but null is the
    // canonical "not configured" representation on the wire.
    const value: string | null = draft === '' ? null : draft;
    try {
      await updateSetting.mutateAsync({ key: setting.key, value });
      toast.success(t.settings.saved);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <SaveableSettingRow
      setting={setting}
      isDirty={isDirty}
      isSaving={updateSetting.isPending}
      onSave={save}
    >
      <SelectField
        label={t.settings.subthresholdApprover}
        hint={t.settings.subthresholdApproverHint}
        value={draft}
        disabled={updateSetting.isPending}
        onChange={(event) => setDraft(event.target.value)}
      >
        <option value="">{t.settings.unassigned}</option>
        {approvers.map((approver) => (
          <option key={approver.id} value={approver.id}>
            {approver.fullName}
          </option>
        ))}
      </SelectField>
    </SaveableSettingRow>
  );
}

function ApproverSlotRow({
  slotNo,
  slots,
  approvers,
}: {
  slotNo: 1 | 2;
  slots: ApproverSlot[];
  approvers: { id: string; fullName: string; isActive?: boolean | null }[];
}) {
  const toast = useToast();
  const setSlot = useSetApproverSlot();
  // OPEN QUESTION: OQ-02 — only the company-wide default is editable here for now. Once OQ-02
  // is answered this either stays as-is or grows a per-department row.
  const current = slots.find((slot) => slot.slotNo === slotNo && slot.departmentId === null);
  // The slot has a row pointing at a user, but that user is deactivated — submit will be
  // refused until either the user is re-activated or the slot is re-assigned. Surface this
  // so the admin doesn't have to discover it by submitting a test requisition (Phase 05).
  const heldByInactive = current?.userId !== null && current?.userId !== undefined && current?.isActive === false;

  async function onChange(userId: string) {
    try {
      await setSlot.mutateAsync({
        departmentId: null,
        slotNo,
        userId: userId === '' ? null : userId,
      });
      toast.success(t.settings.slotSaved);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <div className="border-b border-border px-4 py-4 last:border-b-0">
      <SelectField
        label={`${t.settings.slot} ${slotNo} — ${t.settings.companyDefault}`}
        hint={
          heldByInactive
            ? t.settings.slotHeldByInactive
            : t.settings.onlyApprovers
        }
        value={current?.userId ?? ''}
        disabled={setSlot.isPending}
        onChange={(event) => void onChange(event.target.value)}
        error={heldByInactive ? t.settings.slotHeldByInactiveWarning : undefined}
      >
        <option value="">{t.settings.unassigned}</option>
        {approvers.map((approver) => (
          <option key={approver.id} value={approver.id}>
            {approver.fullName}
            {approver.isActive === false ? ` (${t.common.inactive})` : ''}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function SettingControl({ setting, approvers }: {
  setting: Setting;
  approvers: { id: string; fullName: string }[];
}) {
  switch (setting.key) {
    case SettingKey.SUBTHRESHOLD_APPROVER_USER_ID:
      return <SubthresholdApproverSetting setting={setting} approvers={approvers} />;
    case SettingKey.AUDIT_RETENTION_DAYS:
      return <AuditRetentionSetting setting={setting} />;
    case SettingKey.AUDIT_ENABLED_ACTIONS:
      return <AuditActionsSetting setting={setting} />;
    default:
      return <NumericSettingRow setting={setting} />;
  }
}

export function SettingsPage() {
  const settings = useSettings();
  const slots = useApproverSlots();
  const approvers = useUsers(APPROVER_QUERY);

  return (
    <>
      <PageHeader title={t.settings.title} subtitle={t.settings.subtitle} />

      <div className="flex flex-col gap-6">
        <Panel>
          <QueryBoundary
            isLoading={settings.isPending}
            error={settings.error}
            data={settings.data}
            onRetry={() => void settings.refetch()}
          >
            {(data) =>
              data
                // Phase 05: the explicit sub-threshold approver replaces the historical
                // "approver count below threshold" input. Keep the old setting in storage for
                // backward compatibility, but do not present two controls for the same policy.
                .filter(
                  (setting) => setting.key !== SettingKey.APPROVER_SLOTS_BELOW_THRESHOLD,
                )
                .map((setting) => (
                  <SettingControl
                    key={setting.key}
                    setting={setting}
                    approvers={approvers.data?.items ?? []}
                  />
                ))
            }
          </QueryBoundary>
        </Panel>

        <div>
          <h2 className="mb-2 text-base font-semibold text-ink">{t.settings.approverSlotsTitle}</h2>
          <p className="mb-3 text-sm text-ink-muted">{t.settings.approverSlotsSubtitle}</p>
          <Panel>
            <QueryBoundary
              isLoading={slots.isPending}
              error={slots.error}
              data={slots.data}
              onRetry={() => void slots.refetch()}
            >
              {(data) =>
                approvers.isPending ? (
                  <LoadingState />
                ) : (
                  APPROVER_SLOT_NUMBERS.map((slotNo) => (
                    <ApproverSlotRow
                      key={slotNo}
                      slotNo={slotNo}
                      slots={data}
                      approvers={approvers.data?.items ?? []}
                    />
                  ))
                )
              }
            </QueryBoundary>
          </Panel>
        </div>
      </div>
    </>
  );
}
