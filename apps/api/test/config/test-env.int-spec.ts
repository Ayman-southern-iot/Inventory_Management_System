import { describe, expect, it } from 'vitest';
import { RAW_CONFIG_KEYS } from '../../src/config/config.schema';
import { TEST_ENV } from './test-env';

/**
 * Guards the harness against the bug class that made this suite's baseline machine-dependent.
 *
 * `TEST_ENV` forces its values onto `process.env` so a developer's shell cannot redirect the
 * integration suite. But that protection only covers keys it actually names — an unnamed key
 * falls through to the root `.env`, and the spec that depends on it starts passing or failing
 * according to whose machine ran it. Three keys did exactly that:
 *
 *   - `DEMO_ACCOUNTS_ENABLED=true` failed the two specs asserting demo mode is off by default.
 *   - `PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (the Alpine container path) made
 *     every unstubbed PDF render fail on a Windows host.
 *   - `REPORTING_TIME_ZONE` was unset, so the reports specs passed only because this machine
 *     agreed with the schema default.
 *
 * Five of eleven baseline failures traced to that one missing invariant. So: every key the
 * backend reads is either pinned above or listed here with a reason. The allowlist is the part
 * a reviewer reads — if an entry's reason no longer holds, the entry is the bug.
 */

/**
 * Keys deliberately left to their schema default, with why. A reason that stops being true is a
 * signal to pin the key, not to widen this list.
 */
const ALLOWLISTED: Record<string, string> = {
  // Letterhead content. Cosmetic, and no spec asserts what appears on the PDF.
  COMPANY_NAME: 'PDF letterhead text; not asserted.',
  COMPANY_ADDRESS: 'PDF letterhead text; not asserted.',
  COMPANY_LOGO_PATH: 'PDF letterhead asset; not asserted.',

  // Inert while demo mode is pinned off above: nothing reads these unless it is enabled.
  DEMO_ACCOUNT_EMAILS: 'Unread while DEMO_ACCOUNTS_ENABLED is pinned false.',
  DEMO_ACCOUNT_PASSWORD: 'Unread while DEMO_ACCOUNTS_ENABLED is pinned false.',
  DEMO_ACCOUNT_PASSWORD_OVERRIDES: 'Unread while DEMO_ACCOUNTS_ENABLED is pinned false.',

  // PDF layout. boms-pdf.int-spec.ts substitutes a stub PdfRendererService, so no spec
  // exercises real layout or the real renderer's timeout.
  PDF_LETTERHEAD_PATH: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_PAGE_FORMAT: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_MARGIN_TOP_MM: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_MARGIN_RIGHT_MM: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_MARGIN_BOTTOM_MM: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_MARGIN_LEFT_MM: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_RENDER_TIMEOUT_MS: 'Renderer is stubbed in boms-pdf.int-spec.ts.',
  PDF_SIGNED_URL_TTL_SECONDS:
    'Changes only how long a download token stays valid, not whether the flow works.',

  // G-18: the suite writes uploads into the dev storage directory and leaves orphans behind.
  // Pinning these two to a temp dir is the fix for that gap and is deliberately not done here —
  // it changes where every upload spec writes, which wants its own change and its own gate.
  FILE_STORAGE_DIR: 'Known gap G-18; pinning it is the fix and is out of scope here.',
  PDF_STORAGE_DIR: 'Known gap G-18; pinning it is the fix and is out of scope here.',

  // Monitoring thresholds. monitoring.int-spec.ts drives the values it asserts on.
  MONITOR_DISK_WARN_PERCENT: 'monitoring.int-spec.ts sets what it asserts.',
  MONITOR_BACKUP_MAX_AGE_HOURS: 'monitoring.int-spec.ts sets what it asserts.',
  MONITOR_BACKUP_DIR: 'monitoring.int-spec.ts sets what it asserts.',

  // First-boot seeds for `app_settings`. Any spec that depends on one of these writes it
  // through SettingsService first — see requisitions.int-spec.ts's beforeEach, which sets
  // SUBTHRESHOLD_APPROVER_USER_ID rather than trusting the env seed.
  SETTING_SUBTHRESHOLD_APPROVER_USER_ID: 'Seed only; specs set the row via SettingsService.',
  SETTING_BOM_OVER_BUDGET_TOLERANCE_PCT: 'Seed only; specs set the row via SettingsService.',
  SETTING_AUDIT_ENABLED_ACTIONS: 'Seed only; specs set the row via SettingsService.',
  SETTING_AUDIT_RETENTION_DAYS: 'Seed only; specs set the row via SettingsService.',

  // Upload ceilings. The specs that probe limits build payloads relative to the configured
  // value, so a differing host default shifts the payload with it.
  UPLOAD_MAX_IMAGE_BYTES: 'Limit specs size their payloads from the configured value.',
  UPLOAD_MAX_DOCUMENT_BYTES: 'Limit specs size their payloads from the configured value.',
};

describe('TEST_ENV covers every config key', () => {
  const pinned = new Set(Object.keys(TEST_ENV));
  const allowlisted = new Set(Object.keys(ALLOWLISTED));

  it('pins or allowlists every key the backend reads', () => {
    const uncovered = RAW_CONFIG_KEYS.filter(
      (key) => !pinned.has(key) && !allowlisted.has(key),
    );
    expect(
      uncovered,
      `Unpinned config keys inherit the developer's .env and make this suite machine-dependent. ` +
        `Pin each one in TEST_ENV, or add it to ALLOWLISTED with a reason: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('has no allowlist entry for a key that no longer exists', () => {
    const schemaKeys = new Set(RAW_CONFIG_KEYS);
    const stale = [...allowlisted].filter((key) => !schemaKeys.has(key));
    expect(stale, `Allowlisted keys absent from config.schema.ts: ${stale.join(', ')}`).toEqual([]);
  });

  it('has no allowlist entry that is also pinned', () => {
    // Both at once is ambiguous: the reason claims the default is fine while the pin overrides
    // it. Whichever is right, the other is misleading to the next reader.
    const both = [...allowlisted].filter((key) => pinned.has(key));
    expect(both, `Keys both pinned and allowlisted: ${both.join(', ')}`).toEqual([]);
  });

  it('gives every allowlisted key a non-empty reason', () => {
    const unexplained = Object.entries(ALLOWLISTED)
      .filter(([, reason]) => reason.trim().length === 0)
      .map(([key]) => key);
    expect(unexplained).toEqual([]);
  });
});
