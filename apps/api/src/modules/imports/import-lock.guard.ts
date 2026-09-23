import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemImportInProgressError } from '../../common/errors';
import { ImportLockService } from './import-lock.service';

/**
 * Refuses every request while an import is applying (`importing_data.md` §8).
 *
 * **Deny by default.** A route is reachable during an import only if it says so, which is the
 * right way round: the four exceptions below are each there because without them the feature
 * traps everybody including itself, and a fifth should have to be argued for.
 */
export const ALLOW_DURING_IMPORT_KEY = 'allowDuringImport';

/**
 * The four routes that must survive the lockout, and why each one is not negotiable:
 *
 * - `GET /inventory/imports/:id` — how anyone sees progress at all, including the admin who
 *   started it.
 * - `POST /auth/refresh` — access tokens last fifteen minutes. A twenty-minute import would log
 *   the watching admin out mid-run and leave nobody able to abandon it.
 * - `GET /health` — the container health check. Without it Docker restarts the API mid-import,
 *   which is the one thing worse than a slow import.
 * - `POST /inventory/imports/:id/abandon` — the manual release. A lockout with no way out is a
 *   lockout that ends in a container restart.
 */
export const AllowDuringImport = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DURING_IMPORT_KEY, true);

@Injectable()
export class ImportLockGuard implements CanActivate {
  constructor(
    private readonly lock: ImportLockService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The overwhelmingly common case, and it costs one property read. No database work happens
    // on a request unless the system is actually locked.
    if (!this.lock.isLocked()) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_IMPORT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    /*
     * Locked — but is the holder still alive? This is the only place the crash guard runs, and
     * it runs here rather than on a timer because §3.6 rules out a job framework and because a
     * lock nobody is checking is a lock nobody needs released. The cost is one query per refused
     * request, which only happens while locked.
     */
    if (await this.lock.releaseIfDead()) return true;

    throw new SystemImportInProgressError(this.lock.status().estimatedFinishAt);
  }
}
