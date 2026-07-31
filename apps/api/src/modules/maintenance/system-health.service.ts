import { Inject, Injectable, Logger } from '@nestjs/common';
import { readdir, stat, statfs, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { sql } from 'kysely';
import { DB } from '../../database/database.module';
import type { Db } from '../../database/create-db';
import { CONFIG, type AppConfig } from '../../config';

/** One thing that can be wrong, and whether it currently is. */
export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SystemHealth {
  ok: boolean;
  checks: HealthCheck[];
}

const MS_PER_HOUR = 60 * 60 * 1000;
const BYTES_PER_GB = 1024 ** 3;

/**
 * Phase 06 task 6.4 — the monitoring floor.
 *
 * Four things can go wrong quietly on a single VM, and all four are silent until someone tries to
 * do their job:
 *
 *   1. the database becomes unreachable — loud, already covered by `/health`
 *   2. **the disk fills** — Postgres stops accepting writes, and the first symptom users see is
 *      an unrelated-looking 500
 *   3. **the storage directory stops being writable** — uploads fail while everything else looks
 *      perfectly healthy
 *   4. **backups quietly stop** — nothing fails at all, and nobody finds out until a restore
 *
 * Numbers 2–4 are the reason this exists. None of them raises an error on its own.
 */
@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async check(): Promise<SystemHealth> {
    const checks = await Promise.all([
      this.database(),
      this.diskSpace(),
      this.storageWritable(),
      this.backupFreshness(),
    ]);
    return { ok: checks.every((check) => check.ok), checks };
  }

  private async database(): Promise<HealthCheck> {
    try {
      await sql`SELECT 1`.execute(this.db);
      return { name: 'database', ok: true, detail: 'reachable' };
    } catch (error) {
      return { name: 'database', ok: false, detail: (error as Error).message };
    }
  }

  /**
   * Disk headroom on the volume holding uploads.
   *
   * Uses the free space available *to this user* rather than the raw total: on most filesystems a
   * few percent is reserved for root, so a process can be unable to write while a naive
   * used/total calculation still reads comfortable.
   */
  private async diskSpace(): Promise<HealthCheck> {
    try {
      const stats = await statfs(resolve(this.config.uploads.storageDir));
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      if (total === 0) return { name: 'disk', ok: true, detail: 'not reported by this filesystem' };

      const usedPercent = Math.round(((total - free) / total) * 100);
      const freeGb = (free / BYTES_PER_GB).toFixed(1);
      return {
        name: 'disk',
        ok: usedPercent < this.config.monitoring.diskWarnPercent,
        detail: `${usedPercent}% used, ${freeGb} GB free (warn at ${this.config.monitoring.diskWarnPercent}%)`,
      };
    } catch (error) {
      // A filesystem that cannot be measured is not automatically broken; say so rather than
      // raising a false alarm every hour.
      return { name: 'disk', ok: true, detail: `not measurable: ${(error as Error).message}` };
    }
  }

  /**
   * Actually writes a file. Checking permissions with `access()` answers a different question —
   * a full or read-only-remounted volume passes that check and still fails every upload.
   */
  private async storageWritable(): Promise<HealthCheck> {
    const probe = join(resolve(this.config.uploads.storageDir), '.health-probe');
    try {
      await writeFile(probe, String(Date.now()));
      await unlink(probe);
      return { name: 'storage', ok: true, detail: 'writable' };
    } catch (error) {
      return { name: 'storage', ok: false, detail: (error as Error).message };
    }
  }

  /**
   * The newest backup, by file mtime.
   *
   * A backup job that has silently stopped is indistinguishable from a healthy system right up
   * until someone needs a restore — which is the one moment you cannot fix it. If the directory
   * is not configured this reports "not configured" and stays green rather than crying wolf on a
   * dev machine that has never taken one.
   */
  private async backupFreshness(): Promise<HealthCheck> {
    const dir = this.config.monitoring.backupDir;
    if (!dir) return { name: 'backups', ok: true, detail: 'not configured on this host' };

    try {
      const entries = await readdir(resolve(dir));
      const dumps = entries.filter((name) => name.endsWith('.dump'));
      if (dumps.length === 0) {
        return { name: 'backups', ok: false, detail: `no .dump files in ${dir}` };
      }

      const times = await Promise.all(
        dumps.map(async (name) => (await stat(join(resolve(dir), name))).mtimeMs),
      );
      const newest = Math.max(...times);
      const ageHours = (Date.now() - newest) / MS_PER_HOUR;
      const max = this.config.monitoring.backupMaxAgeHours;

      return {
        name: 'backups',
        ok: ageHours <= max,
        detail: `newest backup is ${ageHours.toFixed(1)}h old (limit ${max}h)`,
      };
    } catch (error) {
      return { name: 'backups', ok: false, detail: (error as Error).message };
    }
  }
}
