import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsRepository } from './locations.repository';
import { LocationsService } from './locations.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsRepository, LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
