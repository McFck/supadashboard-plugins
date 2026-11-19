export class PhaseClock {
  private key = '';
  private startedAt = 0;

  elapsed(key: string, wallMs: number): number {
    if (!Number.isFinite(wallMs)) throw new Error('Screen clock must be finite');
    if (key !== this.key) {
      this.key = key;
      this.startedAt = wallMs;
    }
    // A wall clock set backwards must not run the cycle backwards.
    this.startedAt = Math.min(this.startedAt, wallMs);
    return wallMs - this.startedAt;
  }
}
