/** Global input mutex: only one window may raise/click/paste/send at a time. */
export class InputLock {
  private tail: Promise<void> = Promise.resolve();
  holder: string | null = null;
  async run<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tail; let release!: () => void;
    this.tail = new Promise(r => (release = r));
    await prev; this.holder = owner;
    try { return await fn(); } finally { this.holder = null; release(); }
  }
}
