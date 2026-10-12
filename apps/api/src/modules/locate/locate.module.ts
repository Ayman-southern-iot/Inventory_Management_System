import { Module } from '@nestjs/common';
import { LocateController } from './locate.controller';
import { LocateFeed } from './locate-feed';
import { LocateRepository } from './locate.repository';
import { LocateService } from './locate.service';

/**
 * Drawer lights (Phase 13). Reads stock, writes nothing to the database: the only state is the
 * in-memory event feed.
 */
@Module({
  controllers: [LocateController],
  providers: [LocateService, LocateFeed, LocateRepository],
})
export class LocateModule {}
