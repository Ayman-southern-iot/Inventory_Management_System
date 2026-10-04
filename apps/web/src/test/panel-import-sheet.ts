import importSheet from '@/features/panel/layout/ims-import-v4.csv?raw';

/**
 * The "IMS Import" sheet of Lab_Inventory_and_Drawer_Plan_v4.xlsx, exported to CSV unchanged:
 * one row per compartment, with the drawer code (`Zone code`), the cell code (`Compartment code`)
 * and the address printed on the cell (`Label / QR text`).
 */
export interface ImportSheetRow {
  zoneCode: string;
  zoneName: string;
  compartmentCode: string;
  label: string;
}

/** RFC 4180, enough for this file: quoted fields with commas, `""` escapes, `\n` row ends. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length > 0) rows.push([...row, field]);
  return rows;
}

export function importSheetRows(): ImportSheetRow[] {
  const [header, ...rows] = parseCsv(importSheet);
  const column = (name: string) => {
    const index = header!.indexOf(name);
    if (index < 0) throw new Error(`IMS Import sheet: no "${name}" column`);
    return index;
  };
  const zoneCode = column('Zone code');
  const zoneName = column('Zone name');
  const compartmentCode = column('Compartment code');
  const label = column('Label / QR text');
  return rows.map((row) => ({
    zoneCode: row[zoneCode]!,
    zoneName: row[zoneName]!,
    compartmentCode: row[compartmentCode]!,
    label: row[label]!,
  }));
}
