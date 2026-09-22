import { Inject, Injectable } from '@nestjs/common';
import {
  formatLocation,
  type Catalogue,
  type CatalogueCategory,
  type CatalogueLocation,
  type CatalogueProduct,
  type CatalogueQuery,
  type CatalogueStockAt,
  type CategoryNode,
} from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { CategoriesService } from '../categories/categories.service';
import { LocationsService } from '../locations/locations.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';

/**
 * Assembles the catalogue for a consuming search screen.
 *
 * It composes the four services that already own this data rather than writing its own SQL, so
 * a change to how a category tree or a room tree is built reaches this endpoint without anybody
 * remembering to update it. The one query it owns is the bulk placement read, because the
 * per-product version would be an N+1 across the entire catalogue.
 *
 * Everything else here is reshaping: resolving category paths once so the consumer never walks
 * a tree, formatting location labels through the same helper the IMS itself uses, and dropping
 * the fields a display has no use for.
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
    const [tree, rooms, placementRows] = await Promise.all([
      this.categories.tree(),
      this.locations.listRooms(query.includeInactive),
      this.stock.allPlacements(),
    ]);

    // One definition of "every product", shared with the round-trip export — see
    // ProductsService.listAll. It refuses past the ceiling rather than truncating.
    const products = await this.products.listAll({
      includeInactive: query.includeInactive,
      max: this.config.catalogue.maxProducts,
    });

    // id → the category with its ancestry already resolved, so neither the products below nor
    // the consumer has to walk `parentId` upwards.
    const categoriesById = flattenTree(tree);

    /*
     * Placements grouped in memory from one scan. The alternative — `placementsForProduct` per
     * product — is a query per row, which `rules/40-database.md` calls a review blocker and
     * which gets slower exactly as the catalogue this endpoint exists to serve grows.
     */
    const stockByProduct = new Map<string, CatalogueStockAt[]>();
    for (const row of placementRows) {
      const list = stockByProduct.get(row.product_id) ?? [];
      list.push({
        compartmentId: row.compartment_id,
        label: formatLocation({
          roomName: row.room_name,
          zoneName: row.zone_name,
          compartmentCode: row.compartment_code,
        }),
        room: row.room_name,
        zone: row.zone_name,
        compartment: row.compartment_code,
        storageId: row.storage_id,
        quantity: row.quantity,
        // Matches `available` everywhere else in the system: reserved and quarantined units are
        // physically present but not takeable, and showing them as available would be a lie a
        // search screen repeats to whoever walks up to it.
        available: row.quantity - row.reserved_qty - row.quarantined_qty,
      });
      stockByProduct.set(row.product_id, list);
    }

    const items: CatalogueProduct[] = products.map((product) => ({
      id: product.id,
      code: product.productCode,
      name: product.name,
      description: product.description,
      unit: product.unit,
      category: product.categoryId ? (categoriesById.get(product.categoryId) ?? null) : null,
      stock: {
        // `totalOwned` is on-hand plus in-use — what the company holds, wherever it is. The
        // other totals answer narrower questions this screen does not ask.
        total: product.totalOwned,
        available: product.totalAvailable,
        inUse: product.totalInUse,
      },
      locations: stockByProduct.get(product.id) ?? [],
    }));

    const categories = [...categoriesById.values()]
      .filter((category) => query.allCategories || category.productCount > 0)
      .sort((a, b) => a.path.join(' / ').localeCompare(b.path.join(' / ')));

    const locations = flattenRooms(rooms);

    return {
      generatedAt: new Date().toISOString(),
      products: items,
      categories,
      locations,
      counts: {
        products: items.length,
        categories: categories.length,
        locations: locations.length,
      },
    };
  }
}

/**
 * Walks the nested tree once and returns every node keyed by id, carrying the names of its
 * ancestors. Doing it here means a product's breadcrumb is a property, not a traversal the
 * consumer has to implement — and implement identically to how we would have.
 */
function flattenTree(nodes: CategoryNode[]): Map<string, CatalogueCategory> {
  const byId = new Map<string, CatalogueCategory>();

  const walk = (node: CategoryNode, ancestors: string[]): void => {
    const path = [...ancestors, node.name];
    byId.set(node.id, {
      id: node.id,
      name: node.name,
      path,
      // The subtree count, not the node's own: a parent shown with 0 while its children hold
      // things reads as empty, and is the reason to hide it when it genuinely is.
      productCount: node.productCountInTree,
    });
    for (const child of node.children) walk(child, path);
  };

  for (const node of nodes) walk(node, []);
  return byId;
}

/** Room → Zone → Compartment flattened to a list of shelves, each already labelled. */
function flattenRooms(
  rooms: ReadonlyArray<{
    name: string;
    zones: ReadonlyArray<{
      name: string;
      compartments: ReadonlyArray<{ id: string; code: string; storageId: string }>;
    }>;
  }>,
): CatalogueLocation[] {
  const out: CatalogueLocation[] = [];
  for (const room of rooms) {
    for (const zone of room.zones) {
      for (const compartment of zone.compartments) {
        out.push({
          compartmentId: compartment.id,
          label: formatLocation({
            roomName: room.name,
            zoneName: zone.name,
            compartmentCode: compartment.code,
          }),
          room: room.name,
          zone: zone.name,
          compartment: compartment.code,
          storageId: compartment.storageId,
        });
      }
    }
  }
  return out;
}
