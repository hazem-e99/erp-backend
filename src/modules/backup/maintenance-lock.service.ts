import { Injectable } from '@nestjs/common';

/**
 * Global in-memory flag set during destructive restores. A guard returns 503 on
 * non-auth routes while the lock is held so the app doesn't read half-restored data.
 */
@Injectable()
export class MaintenanceLockService {
  private locked = false;
  private reason: string | null = null;
  private since: Date | null = null;

  acquire(reason: string): boolean {
    if (this.locked) return false;
    this.locked = true;
    this.reason = reason;
    this.since = new Date();
    return true;
  }

  release() {
    this.locked = false;
    this.reason = null;
    this.since = null;
  }

  status() {
    return { locked: this.locked, reason: this.reason, since: this.since };
  }
}
