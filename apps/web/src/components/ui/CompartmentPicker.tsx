import { useEffect, useMemo, useState } from 'react';
import type { Zone } from '@ims/shared';
import { SelectField } from '@/components/ui/Field';
import { t } from '@/i18n/en';

/**
 * Where the stock goes: zone first, then the compartments inside it.
 *
 * One flat "Meta · 2A" list works while there are five compartments and stops working the moment
 * there are fifty — the reader has to scan every zone's shelves to find the one they want. Ayman,
 * 2026-09-02: pick the zone, then pick from what is in it.
 *
 * The zone select stays on screen even when there is only one zone. A control that appears and
 * disappears depending on how much data exists is harder to learn than one extra click, and the
 * shape of a form should not change under a user because an admin added a shelf.
 */
export function CompartmentPicker({
  zones,
  value,
  onChange,
  required = true,
  disabled,
  error,
}: {
  zones: Zone[];
  /** The chosen compartment id, or '' for none. */
  value: string;
  onChange: (compartmentId: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
}) {
  /**
   * The zone is its own state, not derived from the compartment.
   *
   * Deriving it looks tidier and does not work: clearing the compartment on a zone change would
   * clear the zone too, so the second select could never be reached. The zone is a step the user
   * has taken, and a step they have taken has to survive the next one being empty.
   */
  const [zoneId, setZoneId] = useState('');

  /*
   * Follow the value when it is set from outside — a form resetting between dialogs, or a line
   * arriving with a compartment already on it. Only when the two disagree, so typing in the
   * second select never fights this.
   */
  useEffect(() => {
    if (!value) return;
    const owning = zones.find((zone) => zone.compartments.some((c) => c.id === value));
    if (owning && owning.id !== zoneId) setZoneId(owning.id);
  }, [value, zones, zoneId]);

  /*
   * Only active shelves are offered. A deactivated one is out of use by an admin's decision, and
   * putting stock on it is what deactivating was meant to prevent — but anything already chosen
   * stays selectable, so an in-flight form cannot silently lose its value.
   */
  const activeZones = useMemo(
    () => zones.filter((zone) => zone.isActive || zone.id === zoneId),
    [zones, zoneId],
  );

  const compartments = useMemo(() => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) return [];
    return zone.compartments.filter((c) => c.isActive || c.id === value);
  }, [zones, zoneId, value]);

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={t.compartmentPicker.zone}
        required={required}
        disabled={disabled}
        value={zoneId}
        onChange={(event) => {
          setZoneId(event.target.value);
          /*
           * Changing the zone clears the compartment.
           *
           * Keeping it would leave the form holding a shelf from a zone the user is no longer
           * looking at, and submitting a perfectly valid id for the wrong place — a mistake
           * nothing downstream can catch, because both halves are individually correct.
           */
          onChange('');
        }}
      >
        <option value="">{t.compartmentPicker.zonePlaceholder}</option>
        {activeZones.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t.compartmentPicker.compartment}
        required={required}
        // Nothing to choose from until a zone is picked, and an empty select is a dead end.
        disabled={disabled || zoneId === ''}
        value={value}
        error={error}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {zoneId === '' ? t.compartmentPicker.compartmentPickZoneFirst : t.compartmentPicker.compartmentPlaceholder}
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
