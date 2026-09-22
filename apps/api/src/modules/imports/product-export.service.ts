import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../../config';
import { CategoriesService } from '../categories/categories.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';
import { SettingsService } from '../settings/settings.service';
import {
  ALWAYS_QUOTED,
  CATEGORY_PATH_SEPARATOR,
  IMPORT_COLUMNS,
  IMPORT_SCHEMA_VERSION,
  STATUS_ACTIVE,
  STATUS_INACTIVE,
  buildFingerprint,
  categoryPaths,
  csvBoolean,
  csvField,
  csvQuoted,
  type ImportColumn,
} from './import-format';

/**
 * Writes the round-trip CSV — the file you hand to Claude, and the file a snapshot is made of.
 *
 * One row per product per shelf, plus one row for a product holding nothing anywhere so that a
 * catalogue entry with no stock survives the round trip instead of quietly vanishing from it.
 *
 * Read-only columns (`reserved`, `available`, `in_use_total`, …) are written because the round
 * trip has to be symmetrical and because a person reading the file wants to see them. The parser
 * ignores them. `in_use_total` in particular can only ever be reported: it is derived from
 * `borrow_requests` at query time, so a CSV could not set it without lying.
 *
 * The ceiling is the import's, not the catalogue's. An export governed by a looser limit than the
 * importer would produce a file that cannot be read back — which for a *snapshot* means a backup
 * nobody can restore, discovered at the worst possible moment.
 */
@Injectable()
export class ProductExportService {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly stock: StockService,
    private readonly settings: SettingsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async toCsv(options: { includeInactive?: boolean } = {}): Promise<string> {
    // Retired products are in by default: this file is the desired state of the whole catalogue,
    // and one that quietly omitted them would deactivate nothing and resurrect nothing while
    // looking complete. The report export is the one that shows only what is live.
    const includeInactive = options.includeInactive ?? true;

    const [tree, placementRows, deploymentId] = await Promise.all([
      this.categories.tree(),
      this.stock.allPlacements(),
      this.settings.deploymentId(),
    ]);

    const productList = await this.products.listAll({
      includeInactive,
      max: this.config.imports.maxRows,
    });

    const paths = categoryPaths(tree);

    /** Grouped from one scan — the per-product query would be an N+1 across the catalogue. */
    const shelves = new Map<string, typeof placementRows>();
    for (const row of placementRows) {
      const list = shelves.get(row.product_id) ?? [];
      list.push(row);
      shelves.set(row.product_id, list);
    }

    const lines: string[] = [
      buildFingerprint({
        exportedAt: new Date(),
        schemaVersion: IMPORT_SCHEMA_VERSION,
        deploymentId,
      }),
      IMPORT_COLUMNS.join(','),
    ];

    for (const product of productList) {
      const productCells = {
        product_id: product.id,
        product_code: product.productCode,
        product_name: product.name,
        description: product.description ?? '',
        unit: product.unit,
        category_id: product.categoryId ?? '',
        category_path: product.categoryId
          ? (paths.get(product.categoryId) ?? []).join(CATEGORY_PATH_SEPARATOR)
          : '',
        default_returnable: csvBoolean(product.defaultReturnable),
        status: product.isActive ? STATUS_ACTIVE : STATUS_INACTIVE,
        in_use_total: product.totalInUse,
        owned_total: product.totalOwned,
      };

      const productShelves = shelves.get(product.id) ?? [];

      if (productShelves.length === 0) {
        /*
         * A product holding nothing still gets a row, with the location columns blank and a
         * quantity of zero. Plan I3 allows exactly that shape, and without it a brand-new
         * catalogue entry would be absent from its own export — so the next import, reading the
         * file as the desired state, would deactivate it.
         */
        lines.push(
          this.row({
            ...productCells,
            storage_id: '',
            room: '',
            zone: '',
            compartment: '',
            on_hand: 0,
            reserved: 0,
            quarantined: 0,
            available: 0,
          }),
        );
        continue;
      }

      for (const shelf of productShelves) {
        lines.push(
          this.row({
            ...productCells,
            storage_id: shelf.storage_id,
            room: shelf.room_name,
            zone: shelf.zone_name,
            compartment: shelf.compartment_code,
            on_hand: shelf.quantity,
            reserved: shelf.reserved_qty,
            quarantined: shelf.quarantined_qty,
            available: shelf.quantity - shelf.reserved_qty - shelf.quarantined_qty,
          }),
        );
      }
    }

    // CRLF: Excel on Windows is the overwhelmingly likely reader, and the parser accepts either.
    return `${lines.join('\r\n')}\r\n`;
  }

  /** Column order is part of the contract, so the row is built from `IMPORT_COLUMNS`, not by hand. */
  private row(cells: Record<ImportColumn, string | number>): string {
    return IMPORT_COLUMNS.map((column) =>
      ALWAYS_QUOTED.includes(column)
        ? csvQuoted(String(cells[column] ?? ''))
        : csvField(cells[column]),
    ).join(',');
  }

}
