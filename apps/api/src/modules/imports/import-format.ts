import type { CategoryNode } from '@ims/shared';

/**
 * The round-trip CSV format — one definition, read by the exporter and (from part C) the parser.
 *
 * `importing_data.md` §4. One row per **product per shelf**: a product on two shelves has two
 * rows with its product columns repeated. That is the only shape that can express reality — the
 * catalogue already splits a ThinkPad across two compartments, and one row per product would
 * collapse that into a stock movement nobody asked for.
 *
 * **Not** the report export at `/reports/inventory/export.csv`. That one is for people and
 * accounting and is shaped for pivoting; this one is a data interchange format carrying ids.
 * Fusing them would force one to compromise.
 */

/**
 * The byte-order mark Excel needs at the front of a UTF-8 CSV, or it decodes the file as the
 * system code page and turns every accented product name into mojibake.
 *
 * Built from its code point rather than written as a literal: a real U+FEFF in a source file is
 * invisible in every editor and diff, which is how it ends up somewhere nobody meant it to be.
 */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** Excel wants the mark; every reader after it wants it gone. */
export function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

export const IMPORT_FORMAT_VERSION = 'v1';

/**
 * The migration this format corresponds to. A property of the format, not of config: it changes
 * when the columns change, and an import compares it to refuse a file written by a newer build.
 */
export const IMPORT_SCHEMA_VERSION = '0038';

/**
 * Column order is part of the contract. The exporter writes them in this order, the parser reads
 * them by name, and the Claude skill is told to preserve both.
 */
export const IMPORT_COLUMNS = [
  'product_id',
  'product_code',
  'product_name',
  'description',
  'unit',
  'category_id',
  'category_path',
  'default_returnable',
  'status',
  'storage_id',
  'room',
  'zone',
  'compartment',
  'on_hand',
  'reserved',
  'quarantined',
  'available',
  'in_use_total',
  'owned_total',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/**
 * Exported for reference, ignored on import.
 *
 * Present in the file because the round trip has to be symmetrical and because somebody reading
 * a spreadsheet wants to see what is reserved and what is out on loan. Editing one is a warning,
 * not an error (plan I9) — silently discarding a person's typing is worse than telling them it
 * was ignored. `in_use_total` and `owned_total` in particular *cannot* be set: they are derived
 * from `borrow_requests` at query time, so a CSV could only lie about them.
 */
export const READ_ONLY_COLUMNS: readonly ImportColumn[] = [
  'reserved',
  'quarantined',
  'available',
  'in_use_total',
  'owned_total',
];

/** Blank is meaningful in these; everywhere else a blank non-numeric column is an error. */
export const NULLABLE_COLUMNS: readonly ImportColumn[] = [
  'product_id',
  'product_code',
  'description',
  'category_id',
  'category_path',
  'storage_id',
  // Location is blank-able only when the quantity is blank or zero — plan I3. The conditional
  // half of that rule is validation's job (part D); this list is the unconditional half.
  'room',
  'zone',
  'compartment',
];

/** The separator between category names in `category_path`, matching `formatLocation`'s. */
export const CATEGORY_PATH_SEPARATOR = ' / ';

/** RFC 4180 quoting: wrap whenever the value holds a comma, a quote or a newline. */
export function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Always quoted, whatever they contain.
 *
 * Excel reads `0001` as the number 1 and `1-2` as a date, and it does it on *open*, before
 * anybody has typed anything — so a code that survived the export can be destroyed by the act of
 * looking at the file. Quoting is not a full defence (Excel still coerces on some locales) but
 * it is the half that costs nothing, and the Claude skill is told to preserve it.
 */
export function csvQuoted(value: string | null | undefined): string {
  const text = value ?? '';
  return `"${text.replace(/"/g, '""')}"`;
}

export const ALWAYS_QUOTED: readonly ImportColumn[] = ['product_code', 'storage_id'];

/**
 * Line one of every file: what it is, when it left, and where from.
 *
 * The origin is checked on import so a file exported from the demo stack cannot be applied to
 * production, where its product ids name nothing and every row would be created afresh. A
 * **restore** skips the origin check and keeps the schema check — it is this deployment's own
 * file by construction (plan §4.4).
 */
export function buildFingerprint(params: {
  exportedAt: Date;
  schemaVersion: string;
  deploymentId: string;
}): string {
  return [
    `# ims-product-import ${IMPORT_FORMAT_VERSION}`,
    `exported ${params.exportedAt.toISOString()}`,
    `schema ${params.schemaVersion}`,
    `origin ${params.deploymentId}`,
  ].join(' · ');
}

export interface Fingerprint {
  version: string;
  exportedAt: string;
  schemaVersion: string;
  deploymentId: string;
}

/** Returns null when the line is not a fingerprint at all, which the parser reports as an error. */
export function parseFingerprint(line: string): Fingerprint | null {
  if (!line.startsWith('# ims-product-import ')) return null;

  const parts = line.slice(2).split(' · ');
  const read = (prefix: string): string | undefined =>
    parts
      .find((part) => part.startsWith(`${prefix} `))
      ?.slice(prefix.length + 1)
      .trim();

  const version = parts[0]?.replace('ims-product-import ', '').trim();
  const exportedAt = read('exported');
  const schemaVersion = read('schema');
  const deploymentId = read('origin');

  if (!version || !exportedAt || !schemaVersion || !deploymentId) return null;
  return { version, exportedAt, schemaVersion, deploymentId };
}

/**
 * `Electronics / Computers / Laptops`, root first.
 *
 * Resolved once here so no consumer has to walk `parent_id` upwards, and so the path in the file
 * means exactly what the path in the catalogue export means.
 */
export function categoryPaths(tree: CategoryNode[]): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  const walk = (node: CategoryNode, ancestors: string[]): void => {
    const path = [...ancestors, node.name];
    byId.set(node.id, path);
    for (const child of node.children) walk(child, path);
  };
  for (const node of tree) walk(node, []);
  return byId;
}

/** `yes` / `no`. Read back case-insensitively by the parser, written lowercase. */
export function csvBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

export const STATUS_ACTIVE = 'Active';
export const STATUS_INACTIVE = 'Inactive';
