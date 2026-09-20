import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  compartmentCodeSchema,
  createRoomSchema,
  nameSchema,
  type Compartment,
  type CreateRoomInput,
  type Room,
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
  useCreateRoom,
  useCreateZone,
  useRooms,
  useUpdateCompartment,
  useUpdateRoom,
  useUpdateZone,
} from '../api';
import { zoneToneFor } from '../zone-colour';

const compartmentFormSchema = z.object({ code: compartmentCodeSchema });
type CompartmentFormValues = z.infer<typeof compartmentFormSchema>;

/**
 * The zone dialog only ever edits a name — which room it belongs to is fixed by where the "New
 * zone" button was pressed, and re-parenting is deliberately not offered (it would invalidate
 * the Storage IDs printed on every shelf underneath).
 */
const zoneFormSchema = z.object({ name: nameSchema });
type ZoneFormValues = z.infer<typeof zoneFormSchema>;

/**
 * Room → Zone → Compartment (migration 0033, ask #3).
 *
 * One panel per room, zones nested inside it, shelves inside those. The nesting is the point:
 * a flat zone list could not answer "what is in the lab" once two rooms each had a Shelf A.
 */
export function LocationsPage() {
  const toast = useToast();
  const [includeInactive, setIncludeInactive] = useState(false);
  const rooms = useRooms(includeInactive);

  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const createCompartment = useCreateCompartment();
  const updateCompartment = useUpdateCompartment();

  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | undefined>(undefined);
  /** Which room a new zone goes into, and which zone is being renamed. */
  const [zoneTarget, setZoneTarget] = useState<{ room: Room; zone?: Zone } | undefined>(undefined);
  const [compartmentTarget, setCompartmentTarget] = useState<
    { zone: Zone; compartment?: Compartment } | undefined
  >(undefined);

  const roomForm = useForm<CreateRoomInput>({
    resolver: zodResolver(createRoomSchema),
    defaultValues: { name: '' },
  });
  const zoneForm = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneFormSchema),
    defaultValues: { name: '' },
  });
  const compartmentForm = useForm<CompartmentFormValues>({
    resolver: zodResolver(compartmentFormSchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    if (roomDialogOpen) roomForm.reset({ name: editingRoom?.name ?? '' });
  }, [roomDialogOpen, editingRoom, roomForm]);

  useEffect(() => {
    if (zoneTarget) zoneForm.reset({ name: zoneTarget.zone?.name ?? '' });
  }, [zoneTarget, zoneForm]);

  useEffect(() => {
    if (compartmentTarget) {
      compartmentForm.reset({ code: compartmentTarget.compartment?.code ?? '' });
    }
  }, [compartmentTarget, compartmentForm]);

  async function submitRoom(values: CreateRoomInput) {
    try {
      if (editingRoom) {
        await updateRoom.mutateAsync({ id: editingRoom.id, input: { name: values.name } });
        toast.success(t.locations.roomUpdated);
      } else {
        await createRoom.mutateAsync(values);
        toast.success(t.locations.roomCreated);
      }
      setRoomDialogOpen(false);
    } catch (error) {
      toast.error(messageForError(error));
    }
  }

  async function submitZone(values: ZoneFormValues) {
    if (!zoneTarget) return;
    try {
      if (zoneTarget.zone) {
        await updateZone.mutateAsync({ id: zoneTarget.zone.id, input: { name: values.name } });
        toast.success(t.locations.zoneUpdated);
      } else {
        await createZone.mutateAsync({ name: values.name, roomId: zoneTarget.room.id });
        toast.success(t.locations.zoneCreated);
      }
      setZoneTarget(undefined);
    } catch (error) {
      // Surfaces the API's own reason — now "already exists in this room", not globally.
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
              setEditingRoom(undefined);
              setRoomDialogOpen(true);
            }}
          >
            {t.locations.newRoom}
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
        isLoading={rooms.isPending}
        error={rooms.error}
        data={rooms.data}
        onRetry={() => void rooms.refetch()}
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
            {data.map((room) => (
              <Panel key={room.id}>
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                  <span className="text-base font-semibold text-ink">{room.name}</span>
                  {!room.isActive ? <Badge tone="danger">{t.common.inactive}</Badge> : null}
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t.common.edit} ${room.name}`}
                      icon={<Pencil aria-hidden className="size-4" />}
                      onClick={() => {
                        setEditingRoom(room);
                        setRoomDialogOpen(true);
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus aria-hidden className="size-4" />}
                      onClick={() => setZoneTarget({ room })}
                    >
                      {t.locations.newZone}
                    </Button>
                  </div>
                </header>

                {room.zones.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-ink-muted">
                    {t.locations.noZones}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3 p-4">
                    {room.zones.map((zone) => (
                      <section
                        key={zone.id}
                        className="rounded-[--radius-control] border border-border"
                      >
                        <header className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
                          <span
                            className={cn(
                              'rounded-[--radius-control] border px-2.5 py-1 text-sm font-semibold',
                              zoneToneFor(zone.id),
                            )}
                          >
                            {zone.name}
                          </span>
                          {!zone.isActive ? (
                            <Badge tone="danger">{t.common.inactive}</Badge>
                          ) : null}
                          <div className="ml-auto flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${t.common.edit} ${zone.name}`}
                              icon={<Pencil aria-hidden className="size-4" />}
                              onClick={() => setZoneTarget({ room, zone })}
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
                          <p className="px-3 py-5 text-center text-sm text-ink-muted">
                            {t.locations.noCompartments}
                          </p>
                        ) : (
                          <ul className="flex flex-wrap gap-2 p-3">
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
                      </section>
                    ))}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
      </QueryBoundary>

      <Dialog
        schema={createRoomSchema}
        open={roomDialogOpen}
        onClose={() => setRoomDialogOpen(false)}
        title={editingRoom ? t.locations.editRoom : t.locations.newRoom}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRoomDialogOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              isLoading={roomForm.formState.isSubmitting}
              onClick={() => void roomForm.handleSubmit(submitRoom)()}
            >
              {t.common.save}
            </Button>
          </>
        }
      >
        <form id="room-form" noValidate onSubmit={roomForm.handleSubmit(submitRoom)}>
          <TextField
            label={t.locations.roomName}
            error={roomForm.formState.errors.name?.message}
            {...roomForm.register('name')}
          />
        </form>
      </Dialog>

      <Dialog
        schema={zoneFormSchema}
        open={zoneTarget !== undefined}
        onClose={() => setZoneTarget(undefined)}
        title={zoneTarget?.zone ? t.locations.editZone : t.locations.newZone}
        footer={
          <>
            <Button variant="secondary" onClick={() => setZoneTarget(undefined)}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              isLoading={zoneForm.formState.isSubmitting}
              onClick={() => void zoneForm.handleSubmit(submitZone)()}
            >
              {t.common.save}
            </Button>
          </>
        }
      >
        <form id="zone-form" noValidate onSubmit={zoneForm.handleSubmit(submitZone)}>
          <TextField
            label={t.locations.zoneName}
            // Which room it lands in is decided by the button, not the form — saying so here
            // is what stops an IM wondering why there is no room picker.
            hint={zoneTarget ? `${t.locations.room}: ${zoneTarget.room.name}` : undefined}
            error={zoneForm.formState.errors.name?.message}
            {...zoneForm.register('name')}
          />
        </form>
      </Dialog>

      <Dialog
        schema={compartmentFormSchema}
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
              type="button"
              isLoading={compartmentForm.formState.isSubmitting}
              onClick={() => void compartmentForm.handleSubmit(submitCompartment)()}
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
            hint={
              compartmentTarget
                ? `${compartmentTarget.zone.roomName} / ${compartmentTarget.zone.name}`
                : undefined
            }
            error={compartmentForm.formState.errors.code?.message}
            {...compartmentForm.register('code')}
          />
        </form>
      </Dialog>
    </>
  );
}
