import { useEffect, useState } from 'react';
import {
  APPROVER_SLOT_NUMBERS,
  Role,
  getSettingDefinition,
  isSettingKey,
  type ApproverSlot,
  type Setting,
  type SettingKey,
} from '@ims/shared';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { PageHeader, Panel } from '@/components/ui/primitives';
import { LoadingState, QueryBoundary } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { messageForError } from '@/lib/error-message';
import { useApproverSlots, useSetApproverSlot, useSettings, useUpdateSetting, useUsers } from './api';

const APPROVER_QUERY = { page: 1, limit: 100, includeInactive: false, role: Role.APPROVER } as const;

/** The registry drives the label, so adding a setting needs no change here. */
function labelFor(key: SettingKey): string {
  const labelKey = getSettingDefinition(key).labelKey as keyof typeof t.settings;
  const label = t.settings[labelKey];
  return typeof label === 'string' ? label : key;
}

function SettingRow({ setting }: { setting: Setting }) {
  const toast = useToast();
  const updateSetting = useUpdateSetting();
  const [draft, setDraft] = useState(String(setting.value ?? ''));

  // A refetch after someone else's change must win over a stale local draft.
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
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-4 last:border-b-0">
      <div className="min-w-56 flex-1">
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
      </div>
      <div className="flex items-center gap-3 pb-2.5">
        <Button
          size="sm"
          disabled={!isDirty}
          isLoading={updateSetting.isPending}
          onClick={() => void save()}
        >
          {t.common.save}
        </Button>
        <p className="text-xs text-ink-subtle">
          {setting.updatedByName
            ? `${t.settings.lastChanged} ${t.settings.by} ${setting.updatedByName}`
            : t.settings.never}
        </p>
      </div>
    </div>
  );
}

function ApproverSlotRow({
  slotNo,
  slots,
  approvers,
}: {
  slotNo: 1 | 2;
  slots: ApproverSlot[];
  approvers: { id: string; fullName: string }[];
}) {
  const toast = useToast();
  const setSlot = useSetApproverSlot();
  // OPEN QUESTION: OQ-02 — only the company-wide default is editable here for now. Once OQ-02
  // is answered this either stays as-is or grows a per-department row.
  const current = slots.find((slot) => slot.slotNo === slotNo && slot.departmentId === null);

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
        hint={t.settings.onlyApprovers}
        value={current?.userId ?? ''}
        disabled={setSlot.isPending}
        onChange={(event) => void onChange(event.target.value)}
      >
        <option value="">{t.settings.unassigned}</option>
        {approvers.map((approver) => (
          <option key={approver.id} value={approver.id}>
            {approver.fullName}
          </option>
        ))}
      </SelectField>
    </div>
  );
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
              data.map((setting) => <SettingRow key={setting.key} setting={setting} />)
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
