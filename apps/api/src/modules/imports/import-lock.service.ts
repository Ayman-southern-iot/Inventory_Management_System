import { Inject, Injectable, Logger } from '@nestjs/common';
import { ImportJobStatus, type ImportLockStatus } from '@ims/shared';
import { CONFIG, type AppConfig } from '../../config';
import { ImportJobsRepository } from './import-jobs.repository';

/**
 * The system-wide lockout (`importing_data.md` §8).
 *
 * While an import is `APPLYING` every other request is refused, because the file is rewriting
 * the catalogue underneath them and a page rendered mid-apply would be a lie.
 *
 * **There are two pieces of state and they must move together (§8.1).** The in-memory boolean is
 * what the guard reads on every request; `import_jobs.status` is what the UI shows and what the
 * one-live index enforces. Clearing one without the other is the failure this whole section
 * exists to prevent — which is why **`release` below is the only way either of them is cleared**,
 * and why abandon and the heartbeat both call it rather than each doing half the job.
 *
 * The boolean is per-process. Single VM, single process, and a database read per request for a
 * flag that is false virtually always would be a query per request forever. **Written down
 * because it breaks the day the API runs two instances** — at which point this becomes a row, or
 * Redis, and the guard pays for a read.
 */
@Injectable()
export class ImportLockService {
  private readonly logger = new Logger(ImportLockService.name);

  /** Null when nothing is applying. Holding the job id makes every log line answer "which one". */
  private live: { jobId: string; estimatedFinishAt: Date } | null = null;

  constructor(
    private readonly repo: ImportJobsRepository,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Step 1 of §5.5, and it must be first: nothing may write from here until release. */
  engage(jobId: string, estimatedFinishAt: Date): void {
    this.live = { jobId, estimatedFinishAt };
    this.logger.log(
      `Import ${jobId} has the system lock until ~${estimatedFinishAt.toISOString()}`,
    );
  }

  /**
   * **The only unlock.** Both stores, one function, three callers: a completed apply, a failed
   * apply, and the abandon/heartbeat path below.
   *
   * `status` is what the job row should end at. Passing null leaves the row alone — the apply
   * path sets its own terminal status and only needs the boolean dropped.
   */
  async release(jobId: string, status: ImportJobStatus | null): Promise<void> {
    if (status !== null) {
      await this.repo.update(jobId, { status, finishedAt: new Date() });
    }
    if (this.live?.jobId === jobId) this.live = null;
    this.logger.log(`Import ${jobId} released the system lock`);
  }

  /**
   * The crash guard (§8.1), checked by the guard on the requests it is already refusing.
   *
   * Two failure modes, and only one of them is a crash. **Process died:** the restart cleared the
   * boolean by itself, but the row still says `APPLYING`, so the UI shows a phantom import and
   * the partial unique index blocks the next one. **Process alive, import task dead** — an
   * unhandled rejection or a hung await — and *nothing* has been cleared: the boolean still
   * refuses everyone and the row still says `APPLYING`. That second one is why this exists, and
   * why it goes through `release` rather than only updating the row.
   *
   * Returns true when it freed something, so the caller can let the request through rather than
   * refusing it and making the user retry for no reason.
   */
  async releaseIfDead(): Promise<boolean> {
    const live = await this.repo.findLive();

    // Nothing holds the slot, but this process still thinks it is locked: the row was cleared
    // elsewhere. Drop the boolean rather than refusing requests for ever.
    if (!live || live.status !== ImportJobStatus.APPLYING) {
      if (this.live === null) return false;
      const stranded = this.live.jobId;
      this.live = null;
      this.logger.warn(`Import ${stranded}: lock held with no applying job; released`);
      return true;
    }

    const last = live.heartbeat_at ?? live.started_at ?? live.created_at;
    const deadline = last.getTime() + this.config.imports.heartbeatTimeoutSeconds * 1000;
    if (Date.now() <= deadline) return false;

    this.logger.error(
      `Import ${live.id}: no heartbeat since ${last.toISOString()}; presumed dead, releasing`,
    );
    await this.release(live.id, ImportJobStatus.FAILED);
    return true;
  }

  /** Written while an apply runs, so a dead task is distinguishable from a slow one. */
  async beat(jobId: string): Promise<void> {
    await this.repo.update(jobId, { heartbeatAt: new Date() });
  }

  isLocked(): boolean {
    return this.live !== null;
  }

  /** Which job holds it, for diagnostics and for a caller that needs to release exactly it. */
  heldJobId(): string | null {
    return this.live?.jobId ?? null;
  }

  /**
   * What an outsider to the import is told. Deliberately almost nothing: that the system is busy
   * and roughly when it will not be. The padding is already in `estimatedFinishAt` — better to
   * say ten minutes and take five.
   */
  status(): ImportLockStatus {
    return {
      isLocked: this.live !== null,
      estimatedFinishAt: this.live?.estimatedFinishAt.toISOString() ?? null,
    };
  }
}
