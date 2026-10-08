/**
 * Enter the drawer plan's rooms, zones and compartments into IMS through the API, as the Locations
 * page would. Decided 2026-10-08: by script rather than by hand (about 170 entries, where one typo
 * silently breaks the panel's join for a cell), and not through the importer, which only matches
 * shelves that already exist (`import-lookups.ts:195`).
 *
 *   node dist/scripts/drawer-plan.js --file <plan.csv> --api <base URL ending in the API prefix> [--apply]
 *
 * The sign-in email and password are read as two lines on stdin, so neither shows in the process
 * list or a shell history. The account needs INVENTORY_MANAGER or ADMIN.
 *
 * Without --apply it changes nothing: it reports what exists and what it would create. With --apply
 * it creates only what is missing (rooms, then zones, then compartments), then reads the tree back
 * and checks every plan row is there and active. Re-running after a success creates nothing. It
 * never renames, moves, reactivates or deactivates anything, and it ignores locations the plan does
 * not name. While any plan location is inactive in IMS it refuses --apply before writing.
 *
 * Exit codes: 0 done (or nothing to do), 1 a check or a call failed, 2 bad usage or a bad file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { Role, loginResponseSchema, roomSchema, type Room } from '@ims/shared';
import {
  applyRefusal,
  matchKey,
  parsePlanCsv,
  planEntry,
  zoneKey,
  type EntryPlan,
  type PlanRow,
} from './drawer-plan/plan';

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const MS_PER_SECOND = 1000;
/** A 429 is waited out and retried this many times before the run gives up. */
const RATE_LIMIT_RETRIES = 5;
/**
 * Used when a 429 carries no Retry-After header: one whole window of the authenticated throttle
 * tier at its default (`THROTTLE_AUTHENTICATED_TTL_SECONDS`), so a retry never lands inside the block.
 */
const RATE_LIMIT_FALLBACK_WAIT_S = 60;
/**
 * The tree with retired rows included. The endpoint hides them by default, and the plan must see
 * them: a retired zone still owns its name (migration 0033), so creating it again is a 409.
 */
const ROOMS_PATH = '/locations/rooms?includeInactive=true';
/** Roles the Locations write endpoints accept (locations.controller.ts). */
const WRITER_ROLES: readonly Role[] = [Role.INVENTORY_MANAGER, Role.ADMIN];

const USAGE =
  'usage: node dist/scripts/drawer-plan.js --file <plan.csv> --api <base URL, e.g. http://host:3000/api/v1> [--apply]\n' +
  '       the sign-in email and password are read as two lines on stdin';

class UsageError extends Error {}

class ApiCallError extends Error {
  constructor(
    readonly call: string,
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${call} -> ${status} ${code}: ${message}`);
  }
}

interface Options {
  file: string;
  api: string;
  apply: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Partial<Options> = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--file') options.file = argv[(i += 1)];
    else if (arg === '--api') options.api = argv[(i += 1)]?.replace(/\/+$/, '');
    else throw new UsageError(`unknown argument "${arg}"`);
  }
  if (!options.file || !options.api) throw new UsageError('--file and --api are both required');
  return options as Options;
}

async function readCredentials(): Promise<{ email: string; password: string }> {
  if (process.stdin.isTTY) throw new UsageError('pipe the email and password in on stdin, one per line');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const [email = '', password = ''] = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  if (email.trim() === '' || password === '') throw new UsageError('stdin must hold the email, then the password');
  return { email: email.trim(), password };
}

const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * MS_PER_SECOND));

/** One HTTP call: JSON in and out, a 429 waited out, any other failure thrown with the API's code. */
async function call<T>(
  api: string,
  token: string | null,
  method: 'GET' | 'POST',
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const label = `${method} ${path}`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = Number(retryAfter(response.headers)) || RATE_LIMIT_FALLBACK_WAIT_S;
      console.log(`  rate limited on ${label}; waiting ${wait} s`);
      await sleep(wait);
      continue;
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      // Not JSON at all: another app answered (NOW.md landmine), reported below with the status.
    }
    if (!response.ok) {
      const envelope = z.object({ code: z.string(), message: z.string() }).safeParse(json);
      throw new ApiCallError(
        label,
        response.status,
        envelope.success ? envelope.data.code : 'NOT_THE_API',
        envelope.success ? envelope.data.message : 'the response is not the API error shape',
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // A 2xx that is not the API's shape: --api most likely points at the SPA or another app.
      throw new Error(`${label}: the response is not what the API returns. Is --api the API's base URL?`);
    }
    return parsed.data;
  }
}

/**
 * The throttler names its header after the tier that blocked (`Retry-After-authenticated`), and
 * the exception filter adds no plain one, so take whichever Retry-After header is present.
 */
function retryAfter(headers: Headers): string | null {
  for (const [name, value] of headers) if (name.startsWith('retry-after')) return value;
  return null;
}

const createdSchema = z.object({ id: z.string().uuid() }).passthrough();
const roomsSchema = z.array(roomSchema);

function report(plan: EntryPlan, rows: readonly PlanRow[]): void {
  console.log(`plan: ${rows.length} compartments, ${new Set(rows.map((r) => matchKey(r.room))).size} rooms, ` +
    `${new Set(rows.map((r) => zoneKey(r.room, r.zone))).size} zones`);
  console.log(`already in IMS: ${plan.present} of ${rows.length} compartments`);
  console.log(`to create: ${plan.rooms.length} rooms, ${plan.zones.length} zones, ${plan.compartments.length} compartments`);
  for (const room of plan.rooms) console.log(`  + room ${room}`);
  for (const { room, zone } of plan.zones) console.log(`  + zone ${room} / ${zone}`);
  const byZone = new Map<string, string[]>();
  for (const { room, zone, code } of plan.compartments) {
    const key = `${room} / ${zone}`;
    byZone.set(key, [...(byZone.get(key) ?? []), code]);
  }
  for (const [zone, codes] of byZone) console.log(`  + ${codes.length} compartments in ${zone}: ${codes.join(' ')}`);
  for (const location of plan.inactive) console.log(`  ! inactive in IMS, not changed: ${location}`);
}

async function apply(api: string, token: string, plan: EntryPlan, tree: readonly Room[]): Promise<void> {
  const roomIds = new Map(tree.map((room) => [matchKey(room.name), room.id]));
  const zoneIds = new Map(tree.flatMap((room) => room.zones.map((zone) => [zoneKey(room.name, zone.name), zone.id])));

  for (const name of plan.rooms) {
    const created = await call(api, token, 'POST', '/locations/rooms', createdSchema, { name });
    roomIds.set(matchKey(name), created.id);
    console.log(`  created room ${name}`);
  }
  for (const { room, zone } of plan.zones) {
    const roomId = roomIds.get(matchKey(room));
    if (roomId === undefined) throw new Error(`no id for room ${room}`);
    const created = await call(api, token, 'POST', '/locations/zones', createdSchema, { name: zone, roomId });
    zoneIds.set(zoneKey(room, zone), created.id);
    console.log(`  created zone ${room} / ${zone}`);
  }
  let created = 0;
  try {
    for (const { room, zone, code } of plan.compartments) {
      const zoneId = zoneIds.get(zoneKey(room, zone));
      if (zoneId === undefined) throw new Error(`no id for zone ${room} / ${zone}`);
      await call(api, token, 'POST', '/locations/compartments', createdSchema, { zoneId, code });
      created += 1;
    }
  } finally {
    // On a failure too, so the operator knows how far it got; a re-run picks up from there.
    if (created > 0) console.log(`  created ${created} of ${plan.compartments.length} compartments`);
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.file)) throw new UsageError(`${options.file}: no such file`);
  const parsed = parsePlanCsv(readFileSync(options.file, 'utf8'));
  if (parsed.errors.length > 0) {
    console.error(`${options.file}: ${parsed.errors.length} problem(s), nothing sent:`);
    for (const error of parsed.errors) console.error(`  ${error}`);
    return EXIT_USAGE;
  }

  const credentials = await readCredentials();
  const session = await call(options.api, null, 'POST', '/auth/login', loginResponseSchema, credentials);
  if (session.user.mustChangePassword) {
    console.error(`${session.user.email} must change its password first; the API refuses everything else until then`);
    return EXIT_FAILED;
  }
  if (!session.user.roles.some((role) => WRITER_ROLES.includes(role))) {
    console.error(`${session.user.email} cannot write locations: it needs ${WRITER_ROLES.join(' or ')}`);
    return EXIT_FAILED;
  }
  console.log(`signed in as ${session.user.email} [${session.user.roles.join(', ')}] at ${options.api}`);

  const tree = await call(options.api, session.accessToken, 'GET', ROOMS_PATH, roomsSchema);
  const plan = planEntry(parsed.rows, tree);
  report(plan, parsed.rows);
  if (!options.apply) {
    console.log('dry run: nothing changed. Re-run with --apply to create the missing locations.');
    return 0;
  }

  const refusal = applyRefusal(plan);
  if (refusal !== null) {
    console.error(`--apply refused, nothing changed: ${refusal}`);
    return EXIT_FAILED;
  }
  await apply(options.api, session.accessToken, plan, tree);
  const after = planEntry(parsed.rows, await call(options.api, session.accessToken, 'GET', ROOMS_PATH, roomsSchema));
  const missing = after.rooms.length + after.zones.length + after.compartments.length;
  if (missing > 0 || after.inactive.length > 0) {
    console.error(`check after apply FAILED: ${missing} location(s) still missing, ${after.inactive.length} inactive`);
    return EXIT_FAILED;
  }
  console.log(`check after apply: all ${parsed.rows.length} plan compartments are in IMS and active.`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
      process.exit(EXIT_USAGE);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(EXIT_FAILED);
  },
);
