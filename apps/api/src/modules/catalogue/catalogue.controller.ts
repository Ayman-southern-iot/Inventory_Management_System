import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiKeyScope,
  catalogueQuerySchema,
  type Catalogue,
  type CatalogueQuery,
} from '@ims/shared';
import { zodPipe } from '../../common/zod-validation.pipe';
import { AuthenticatedThrottle } from '../../common/throttling';
import { ApiKeyScopes } from '../api-keys/api-key.decorators';
import { CatalogueService } from './catalogue.service';

/**
 * One call that returns everything a consuming frontend needs.
 *
 * The rest of the API is built for a screen at a time — a page of products, a tree of
 * categories, a list of zones. A system that mirrors this catalogue wants none of that shape:
 * it wants the lot, in one response, whenever it likes. Three paginated calls stitched together
 * by every consumer is the same work done repeatedly and differently.
 *
 * Reachable by a session too, not only by a key. There is no reason to make it key-only, and a
 * developer debugging an integration should be able to open it while logged in.
 */
@AuthenticatedThrottle
@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @ApiKeyScopes({
    summary:
      'Everything a search screen needs, in one response: each product with its category path, its shelves as readable labels, and how many are total, available and in use. Plus flat category and location lists to filter by.',
    scopes: [ApiKeyScope.INVENTORY_READ],
    query: catalogueQuerySchema,
  })
  @Get()
  async get(@Query(zodPipe(catalogueQuerySchema)) query: CatalogueQuery): Promise<Catalogue> {
    return this.catalogue.build(query);
  }
}
