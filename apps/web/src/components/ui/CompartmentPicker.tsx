import { useEffect, useMemo, useState } from 'react';
import type { Zone } from '@ims/shared';
import { SelectField } from '@/components/ui/Field';
import { t } from '@/i18n/en';

/**
 * Where the stock goes: room, then the zones in it, then the shelves in that zone.
 *
 * One flat "Meta · 2A" list works while there are five compartments and stops working the moment
 * there are fifty — the reader has to scan every zone's shelves to find the one they want. Ayman,
 * 2026-09-02: pick the zone, then pick from what is in it. Migration 0033 added the room above
 * that (ask #3), so this is now three steps, narrowing at each one.
 *
 * Every select stays on screen even when there is only one option at that level. A control that
 * appears and disappears depending on how much data exists is harder to learn than one extra
 * click, and the shape of a form should not change under a user because an admin added a shelf.
 */
export function CompartmentPicker({
  zones,
  value,
  onChange,
  required = true,
  disabled,
  error,
}: {
  /** Flat list of every zone, each carrying its room. The rooms are derived from it below. */
  zones: Zone[];
  /** The chosen compartment id, or '' for none. */
  value: string;
  onChange: (compartmentId: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
}) {
  /**
   * Room and zone are their own state, not derived from the compartment.
   *
   * Deriving them looks tidier and does not work: clearing the compartment on a zone change
   * would clear the zone too, so the next select could never be reached. A step the user has
   * taken has to survive the next one being empty.
   */
  const [roomId, setRoomId] = useState('');
  const [zoneId, setZoneId] = useState('');

  /*
   * Follow the value when it is set from outside — a form resetting between dialogs, or a line
   * arriving with a compartment already on it. Only when they disagree, so typing in a later
   * select never fights this.
   */
  useEffect(() => {
    if (!value) return;
    const owning = zones.find((zone) => zone.compartments.some((c) => c.id === value));
    if (!owning) return;
    if (owning.id !== zoneId) setZoneId(owning.id);
    if (owning.roomId !== roomId) setRoomId(owning.roomId);
  }, [value, zones, zoneId, roomId]);

  /**
   * Rooms are derived from the zone list rather than fetched separately, so the picker has one
   * source of truth and cannot show a room whose zones it does not have.
   */
  const rooms = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const zone of zones) {
      if (!seen.has(zone.roomId)) seen.set(zone.roomId, { id: zone.roomId, name: zone.roomName });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [zones]);

  /*
   * Only active shelves are offered. A deactivated one is out of use by an admin's decision, and
   * putting stock on it is what deactivating was meant to prevent — but anything already chosen
   * stays selectable, so an in-flight form cannot silently lose its value.
   */
  const zonesInRoom = useMemo(
    () => zones.filter((zone) => zone.roomId === roomId && (zone.isActive || zone.id === zoneId)),
    [zones, roomId, zoneId],
  );

  const compartments = useMemo(() => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return [];
    return zone.compartments.filter((c) => c.isActive || c.id === value);
  }, [zones, zoneId, value]);

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={t.compartmentPicker.room}
        required={required}
        disabled={disabled}
        value={roomId}
        onChange={(event) => {
          setRoomId(event.target.value);
          /*
           * Changing the room clears both levels below it.
           *
           * Keeping either would leave the form holding a shelf from a room the user is no
           * longer looking at, and submitting a perfectly valid id for the wrong place — a
           * mistake nothing downstream can catch, because every part is individually correct.
           */
          setZoneId('');
          onChange('');
        }}
      >
        <option value="">{t.compartmentPicker.roomPlaceholder}</option>
        {rooms.map((room) => (
          <option key={room.id} value={room.id}>
            {room.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t.compartmentPicker.zone}
        required={required}
        // Nothing to choose from until a room is picked, and an empty select is a dead end.
        disabled={disabled || roomId === ''}
        value={zoneId}
        onChange={(event) => {
          setZoneId(event.target.value);
          onChange('');
        }}
      >
        <option value="">
          {roomId === ''
            ? t.compartmentPicker.zonePickRoomFirst
            : t.compartmentPicker.zonePlaceholder}
        </option>
        {zonesInRoom.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t.compartmentPicker.compartment}
        required={required}
        disabled={disabled || zoneId === ''}
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {zoneId === ''
            ? t.compartmentPicker.compartmentPickZoneFirst
            : t.compartmentPicker.compartmentPlaceholder}
        </option>
        {compartments.map((compartment) => (
          <option key={compartment.id} value={compartment.id}>
            {compartment.code}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
