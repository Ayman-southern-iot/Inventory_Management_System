import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { ApiKeyDocsService } from './api-key-docs.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysRepository } from './api-keys.repository';
import { ApiKeysService } from './api-keys.service';

/**
 * Phase 10 — credentials issued to systems rather than people.
 *
 * `ApiKeysService` is exported because `JwtAuthGuard` authenticates keys as well as sessions,
 * so `AuthModule` imports this one. The dependency runs that way round and not the other: this
 * module must never import `AuthModule`, or the two deadlock at startup. It gets `RolesGuard`
 * by importing the class directly, which is how every other feature module does it.
 *
 * `DiscoveryModule` is here for the generated usage document, which walks the live route table
 * for `@ApiKeyScopes` metadata rather than trusting a hand-maintained list.
 */
@Module({
  imports: [DiscoveryModule, AuditModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysRepository, ApiKeysService, ApiKeyDocsService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
