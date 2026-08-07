import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  compartmentCodeSchema,
  createZoneSchema,
  type Compartment,
  type CreateZoneInput,
  type Zone,
} from '@ims/shared';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, TextField } from '@/components/ui/Field';
import { Badge, PageHeader, Panel } from '@/components/ui/primitives';
import { EmptyState, QueryBoundary, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/Toast';
import { t } from '@/i18n/en';
import { cn } from '@/lib/cn';
import { messageForError } from '@/lib/error-message';
import {
  useCreateCompartment,
  useCreateZone,
  useUpdateCompartment,
  useUpdateZone,
  useZones,
} from '../api';
import { zoneToneFor } from '../zone-colour';

const compartmentFormSchema = z.object({ code: compartmentCodeSchema });
type CompartmentFormValues = z.infer<typeof compartmentFormSchema>;

export function LocationsPage() {
  const toast = useToast();
  const [includeInactive, setIncludeInactive] = useState(false);
  const zones = useZones(includeInactive);

  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const createCompartment = useCreateCompartment();
  const updateCompartment = useUpdateCompartment();

  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | undefined>(undefined);
  const [compartmentTarget, setCompartmentTarget] = useState<
    { zone: Zone; compartment?: Compartment } | undefined
  >(undefined);

  const zoneForm = useForm<CreateZoneInput>({
    resolver: zodResolver(createZoneSchema),
    defaultValues: { name: '' },
  });
  const compartmentForm = useForm<CompartmentFormValues>({
    resolver: zodResolver(compartmentFormSchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    if (zoneDialogOpen) zoneForm.reset({ name: editingZone?.name ?? '' });
  }, [zoneDialogOpen, editingZone, zoneForm]);

  useEffect(() => {
    if (compartmentTarget) {
      compartmentForm.reset({ code: compartmentTarget.compartment?.code ?? '' });
    }
  }, [compartmentTarget, compartmentForm]);

  async function submitZone(values: CreateZoneInput) {
    try {
      if (editingZone) {
        await updateZone.mutateAsync({ id: editingZone.id, input: { name: values.name } });
        toast.success(t.locations.zoneUpdated);
      } else {
        await createZone.mutateAsync(values);
        toast.success(t.locations.zoneCreated);
      }
      setZoneDialogOpen(false);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function submitCompartment(values: CompartmentFormValues) {
    if (!compartmentTarget) return;
    try {
      if (compartmentTarget.compartment) {
        await updateCompartment.mutateAsync({
          id: compartmentTarget.compartment.id,
          input: { code: values.code },
        });
        toast.success(t.locations.compartmentUpdated);
      } else {
        await createCompartment.mutateAsync({
          zoneId: compartmentTarget.zone.id,
          code: values.code,
        });
        toast.success(t.locations.compartmentCreated);
      }
      setCompartmentTarget(undefined);
    } catch (error) {
      // Surfaces the API's own reason — a duplicate code in this zone, or stock still held.
      toast.error(messageForError(error));
    }
  }

  async function toggleCompartment(compartment: Compartment) {
    try {
      await updateCompartment.mutateAsync({
        id: compartment.id,
        input: { isActive: !compartment.isActive },
      });
      toast.success(t.locations.compartmentUpdated);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  return (
    <>
      <PageHeader
        title={t.locations.title}
        subtitle={t.locations.subtitle}
        action={
          <Button
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => {
              setEditingZone(undefined);
              setZoneDialogOpen(true);
            }}
          >
            {t.locations.newZone}
          </Button>
        }
      />

      <div className="mb-4">
        <Checkbox
          label={t.inventory.showInactive}
          checked={includeInactive}
          onChange={(event) => setIncludeInactive(event.target.checked)}
        />
      </div>

      <QueryBoundary
        isLoading={zones.isPending}
        error={zones.error}
        data={zones.data}
        onRetry={() => void zones.refetch()}
        loadingFallback={
          <Panel>
            <SkeletonRows columns={3} />
          </Panel>
        }
        isEmpty={(data) => data.length === 0}
        emptyFallback={
          <Panel>
            <EmptyState title={t.locations.emptyTitle} body={t.locations.emptyBody} />
          </Panel>
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            {data.map((zone) => (
              <Panel key={zone.id}>
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                  <span
                    className={cn(
                      'rounded-[--radius-control] border px-2.5 py-1 text-sm font-semibold',
                      zoneToneFor(zone.id),
                    )}
                  >
                    {zone.name}
                  </span>
                  {!zone.isActive ? <Badge tone="danger">{t.common.inactive}</Badge> : null}
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t.common.edit} ${zone.name}`}
                      icon={<Pencil aria-hidden className="size-4" />}
                      onClick={() => {
                        setEditingZone(zone);
                        setZoneDialogOpen(true);
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus aria-hidden className="size-4" />}
                      onClick={() => setCompartmentTarget({ zone })}
                    >
                      {t.locations.newCompartment}
                    </Button>
                  </div>
                </header>

                {zone.compartments.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-ink-muted">
                    {t.locations.noCompartments}
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-2 p-4">
                    {zone.compartments.map((compartment) => (
                      <li
                        key={compartment.id}
                        className="flex items-center gap-2 rounded-[--radius-control] border border-border px-3 py-2"
                      >
                        <span
                          className={cn(
                            'font-mono text-sm',
                            !compartment.isActive && 'text-ink-subtle line-through',
                          )}
                        >
                          {compartment.code}
                        </span>
                        {compartment.placementCount > 0 ? (
                          <span className="text-xs text-ink-subtle">
                            {compartment.placementCount} {t.locations.holdingStock}
                          </span>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${t.common.edit} ${compartment.code}`}
                          icon={<Pencil aria-hidden className="size-4" />}
                          onClick={() => setCompartmentTarget({ zone, compartment })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void toggleCompartment(compartment)}
                        >
                          {compartment.isActive ? t.users.deactivate : t.users.activate}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ))}
          </div>
        )}
      </QueryBoundary>

      <Dialog
        open={zoneDialogOpen}
        onClose={() => setZoneDialogOpen(false)}
        title={editingZone ? t.locations.editZone : t.locations.newZone}
        footer={
          <>
            <Button variant="secondary" onClick={() => setZoneDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button form="zone-form" type="submit" isLoading={zoneForm.formState.isSubmitting}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <form id="zone-form" noValidate onSubmit={zoneForm.handleSubmit(submitZone)}>
          <TextField
            label={t.locations.zoneName}
            error={zoneForm.formState.errors.name?.message}
            {...zoneForm.register('name')}
          />
        </form>
      </Dialog>

      <Dialog
        open={compartmentTarget !== undefined}
        onClose={() => setCompartmentTarget(undefined)}
        title={
          compartmentTarget?.compartment
            ? t.locations.editCompartment
            : t.locations.newCompartment
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setCompartmentTarget(undefined)}>
              {t.common.cancel}
            </Button>
            <Button
              form="compartment-form"
              type="submit"
              isLoading={compartmentForm.formState.isSubmitting}
            >
              {t.common.save}
            </Button>
          </>
        }
      >
        <form
          id="compartment-form"
          noValidate
          onSubmit={compartmentForm.handleSubmit(submitCompartment)}
        >
          <TextField
            label={t.locations.compartmentCode}
            hint={compartmentTarget ? `${t.locations.zone}: ${compartmentTarget.zone.name}` : undefined}
            error={compartmentForm.formState.errors.code?.message}
            {...compartmentForm.register('code')}
          />
        </form>
      </Dialog>
    </>
  );
}
