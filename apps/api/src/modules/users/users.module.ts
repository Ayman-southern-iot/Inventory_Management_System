import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FilesModule } from '../files/files.module';
import { ProfileController } from './profile.controller';
import { SelectableUsersController } from './selectable-users.controller';
import { SignatureService } from './signature.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuditModule, NotificationsModule, FilesModule],
  controllers: [UsersController, ProfileController, SelectableUsersController],
  providers: [UsersRepository, UsersService, SignatureService],
  // SignatureService is exported so the BOM renderer can resolve a snapshotted signature.
  exports: [UsersService, UsersRepository, SignatureService],
})
export class UsersModule {}
