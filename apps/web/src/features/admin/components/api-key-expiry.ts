import { API_KEY_EXPIRY_PRESET_DAYS } from '@ims/shared';

/**
 * The expiry the create dialog starts on. Mirrors `createApiKeySchema`'s own default, so that
 * forever is a choice somebody made rather than the value they got by not choosing.
 */
export const DEFAULT_EXPIRY_DAYS = 90;

/** Widened from the tuple's literal type so a configured ceiling can be compared against it. */
const PRESETS: readonly number[] = API_KEY_EXPIRY_PRESET_DAYS;

/**
 * The day counts the expiry select offers. "Never" is not in this list — it is offered
 * separately, and only for a read-only key.
 *
 * A key that can change data must expire within `writeMaxDays` (OQ-KT3), a ceiling from server
 * config that the shared schema cannot see. The dialog offers nothing the server would refuse:
 * the presets at or under the ceiling, plus the ceiling itself when it is not already a preset,
 * so the longest permitted lifetime is always one click away.
 */
export function expiryOptions(isWrite: boolean, writeMaxDays: number): number[] {
  if (!isWrite) return [...PRESETS];
  const within = PRESETS.filter((days) => days <= writeMaxDays);
  return within.includes(writeMaxDays) ? within : [...within, writeMaxDays];
}

/**
 * The expiry to land on after the scopes change. The current choice survives whenever it is
 * still offered; otherwise the default, when that is offered; otherwise the longest option,
 * which only happens for a write key whose ceiling sits under the default.
 */
export function reconcileExpiry(
  current: number | null,
  isWrite: boolean,
  writeMaxDays: number,
): number | null {
  if (current === null && !isWrite) return null;
  const options = expiryOptions(isWrite, writeMaxDays);
  if (current !== null && options.includes(current)) return current;
  if (options.includes(DEFAULT_EXPIRY_DAYS)) return DEFAULT_EXPIRY_DAYS;
  return options[options.length - 1] ?? DEFAULT_EXPIRY_DAYS;
}
