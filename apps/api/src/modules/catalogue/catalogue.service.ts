import { Inject, Injectable } from '@nestjs/common';
import {
  PAGINATION_MAX_LIMIT,
  type Catalogue,
  type CatalogueProduct,
  type CatalogueQuery,
  type CataloguePlacement,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { ConflictError } from '../../common/errors';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';

/**
 * The whole catalogue, assembled once.
 *
 * Ayman, 2026-09-21: another system consumes this one live — a frontend that stores nothing,
 * loads everything on open and lets people search it. It composes the three services that
 * already own this data rather than writing its own SQL, so a change to how a category tree or
 * a room tree is built reaches this endpoint without anybody remembering to update it.
 *
 * The one query it does own is the bulk placement read, because the per-product version would
 * be an N+1 across the entire catalogue.
 */
@Injectable()
export class CatalogueService {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly locations: LocationsService,
    private readonly stock: StockService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async build(query: CatalogueQuery): Promise<Catalogue> {
    const [categories, rooms, placementRows] = await Promise.all([
      this.categories.tree(),
      this.locations.listRooms(query.includeInactive),
      this.stock.allPlacements(),
    ]);

    const products = await this.allProducts(query.includeInactive);

    /*
     * Grouped in memory from one scan. The alternative — `placementsForProduct` per product —
     * is a query per row, which `rules/40-database.md` calls a review blocker and which gets
     * slower exactly as the catalogue this endpoint exists to serve grows.
     */
    const byProduct = new Map<string, CataloguePlacement[]>();
    for (const row of placementRows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push({
        compartmentId: row.compartment_id,
        compartmentCode: row.compartment_code,
        storageId: row.storage_id,
        zoneId: row.zone_id,
        zoneName: row.zone_name,
        roomId: row.room_id,
        roomName: row.room_name,
        quantity: row.quantity,
        // Matches `available` everywhere else: reserved and quarantined units are physically
        // present but not takeable, and a consumer showing them as available would be lying.
        availableQty: row.quantity - row.reserved_qty - row.quarantined_qty,
      });
      byProduct.set(row.product_id, list);
    }

    const items: CatalogueProduct[] = products.map((product) => ({
      id: product.id,
      productCode: product.productCode,
      name: product.name,
      description: product.description,
      unit: product.unit,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      isActive: product.isActive,
      totalQuantity: product.totalQuantity,
      totalAvailable: product.totalAvailable,
      totalOnHand: product.totalOnHand,
      totalInUse: product.totalInUse,
      placements: byProduct.get(product.id) ?? [],
    }));

    return {
      generatedAt: new Date().toISOString(),
      products: items,
      categories,
      rooms,
      counts: { products: items.length, categories: countTree(categories), rooms: rooms.length },
    };
  }

  /**
   * Every product, by walking the paginated list the rest of the system uses.
   *
   * Reusing `ProductsService.list` rather than adding an unpaginated query keeps one definition
   * of what a product row contains and what "active" means. The page size is the same ceiling
   * every other caller gets, so this is a handful of round trips, not one enormous one.
   *
   * It refuses past `CATALOGUE_MAX_PRODUCTS` instead of stopping quietly. A consumer that
   * silently receives 5,000 of 5,200 products has no way to know its search is incomplete, and
   * would go on believing the missing ones do not exist.
   */
  private async allProducts(includeInactive: boolean) {
    const limit = PAGINATION_MAX_LIMIT;
    const max = this.config.catalogue.maxProducts;
    const collected = [];

    for (let page = 1; ; page += 1) {
      const result = await this.products.list({
        page,
        limit,
        includeInactive,
        uncategorized: false,
        inStockOnly: false,
      });

      if (result.total > max) {
        throw new ConflictError(
          `The catalogue holds ${result.total} products, above the ${max} this endpoint will serve in one response. Raise CATALOGUE_MAX_PRODUCTS or read /products page by page instead.`,
        );
      }

      collected.push(...result.items);
      if (collected.length >= result.total || result.items.length === 0) break;
    }

    return collected;
  }
}

/** Categories are nested, so the count has to walk rather than read `.length`. */
function countTree(nodes: ReadonlyArray<{ children: unknown[] }>): number {
  return nodes.reduce(
    (total, node) => total + 1 + countTree(node.children as ReadonlyArray<{ children: unknown[] }>),
    0,
  );
}
