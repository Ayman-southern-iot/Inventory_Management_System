import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from '@ims/shared';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_LINKS } from '../notifications/notifications.links';
import { SystemHealthService, type HealthCheck } from './system-health.service';

/**
 * Phase 06 task 6.4 — the thing that tells a human when the floor gives way.
 *
 * OQ-10 says there is no SMTP relay, so the only channel that reaches a person is the in-app
 * notification the system already has. That is a real limitation and worth being clear about: an
 * admin who never signs in will never see this. It is still strictly better than a log line
 * nobody tails, and the log line is written too.
 *
 * **Only transitions are announced.** Re-notifying every hour that the disk is still 84% full is
 * how an alert becomes wallpaper — the badge stops meaning anything and the next real one is
 * ignored with it. A check that has already been reported stays quiet until it recovers.
 */
@Injectable()
export class MonitoringJob {
  private readonly logger = new Logger(MonitoringJob.name);

  /** Check names currently in the failed state, so recovery and repeats are both detectable. */
  private readonly failing = new Set<string>();

  constructor(
    private readonly health: SystemHealthService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'system-monitoring' })
  async run(): Promise<void> {
    await this.sweep();
  }

  /** Exposed so a test or an admin endpoint can run it on demand. Returns the failing checks. */
  async sweep(): Promise<HealthCheck[]> {
    const { checks } = await this.health.check();
    const failed = checks.filter((check) => !check.ok);
    const failedNames = new Set(failed.map((check) => check.name));

    const newlyFailing = failed.filter((check) => !this.failing.has(check.name));
    const recovered = [...this.failing].filter((name) => !failedNames.has(name));

    for (const check of newlyFailing) {
      this.logger.error(`SYSTEM CHECK FAILED ${check.name}: ${check.detail}`);
    }
    for (const name of recovered) {
      this.logger.log(`System check recovered: ${name}`);
      this.failing.delete(name);
    }

    if (newlyFailing.length > 0) {
      // Best-effort: this is a scheduled job with no transaction to join and no caller to fail.
      // A notification that cannot be written must not stop the log line above from being the
      // record — and must not stop the next sweep either.
      const admins = await this.notifications.usersWithRole(Role.ADMIN);
      for (const check of newlyFailing) {
        await this.notifications.notifyBestEffort({
          type: 'system.check_failed',
          userIds: admins,
          ref: check.name,
          link: NOTIFICATION_LINKS.dashboard,
          entityType: 'system',
          entityId: null,
          actorId: null,
          actorName: null,
          context: { note: check.detail },
        });
        this.failing.add(check.name);
      }
    }

    return failed;
  }
}
