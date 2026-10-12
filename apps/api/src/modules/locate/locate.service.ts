import { Inject, Injectable } from '@nestjs/common';
import type { LocateAccepted } from '@ims/shared';
import { RateLimitedError } from '../../common/errors';
import { CONFIG, type AppConfig } from '../../config';
import { toPlacement } from '../stock/stock.mappers';
import { CallerWindow } from './caller-window';
import { MS_PER_SECOND } from '../../common/time';
import { LocateFeed } from './locate-feed';
import { LocateRepository } from './locate.repository';
import { toDrawers, type ProductWhereabouts } from './locate.rules';

@Injectable()
export class LocateService {
  private readonly perCaller: CallerWindow;

  constructor(
    private readonly repository: LocateRepository,
    private readonly feed: LocateFeed,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.perCaller = new CallerWindow(
      config.throttling.locate.limit,
      config.throttling.locate.ttlSeconds * MS_PER_SECOND,
    );
  }

  /**
   * Lights the drawers holding these products, and returns the event's `seq` — or null when none
   * of them has a shelf, in which case nothing is published and no light changes.
   *
   * `caller` is the bucket the per-caller limit counts in, chosen by the controller. Counted
   * before any work, so a client stuck in a loop is refused whether or not its products resolve
   * to anything.
   */
  async locate(productIds: readonly string[], caller: string): Promise<LocateAccepted> {
    const retryAfterSeconds = this.perCaller.take(caller, Date.now());
    if (retryAfterSeconds > 0) throw new RateLimitedError(retryAfterSeconds);

    const ids = [...new Set(productIds)];
    const drawers = toDrawers(await this.whereabouts(ids));
    if (drawers.length === 0) return { seq: null };
    return { seq: this.feed.publish(drawers).seq };
  }

  private async whereabouts(ids: readonly string[]): Promise<ProductWhereabouts[]> {
    const placements = await this.repository.placementsOf(ids);
    const stocked = new Set(placements.map((row) => row.product_id));
    const runOut = ids.filter((id) => !stocked.has(id));
    // Only the products with no shelf need the ledger — usually none, so usually one query.
    const lastCells = runOut.length === 0 ? [] : await this.repository.lastCellsOf(runOut);

    return ids.map((id) => {
      const last = lastCells.find((row) => row.product_id === id);
      return {
        placements: placements
          .filter((row) => row.product_id === id)
          .map((row) => ({
            room: row.room_name,
            zone: row.zone_name,
            cell: row.compartment_code,
            available: toPlacement(row).availableQty,
          })),
        // A shelf since taken out of use is no longer where the product lives.
        lastCell:
          last !== undefined &&
          last.is_compartment_active &&
          last.is_zone_active &&
          last.is_room_active
            ? { room: last.room_name, zone: last.zone_name, cell: last.compartment_code }
            : null,
      };
    });
  }
}
