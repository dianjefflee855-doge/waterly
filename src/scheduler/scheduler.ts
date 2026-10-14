import { adapterFor } from '../adapters/configs';
import { AppAdapter } from '../adapters/AppAdapter';
import { WindowInfo } from '../core/types';
import { PlatformBridge } from '../platform/PlatformBridge';
import { CaptureCache, FrameDiffer } from '../perception/frameDiff';
import { Perception } from '../perception/pipeline';
import { LlmClient } from '../llm/minimax';
import { InputLock } from './inputLock';
import { WindowWorker } from './windowWorker';

export const MAX_WINDOWS = 5;

/** One target window per chat app (max 5), each with its own state machine; one global input lock. */
export class Scheduler {
  workers: WindowWorker[] = [];
  lock = new InputLock();
  cache: CaptureCache; differ = new FrameDiffer();
  private timer?: NodeJS.Timeout;
  constructor(private bridge: PlatformBridge, private perception: Perception, private llm: LlmClient) { this.cache = new CaptureCache(bridge, 100); }

  bind(win: WindowInfo, adapter?: AppAdapter) {
    if (this.workers.length >= MAX_WINDOWS) throw new Error(`max ${MAX_WINDOWS} windows`);
    const a = adapter ?? adapterFor(win.bundleId);
    if (!a) throw new Error('no adapter for ' + win.bundleId);
    if (this.workers.some(w => w.adapter.config.id === a.config.id)) throw new Error(`already bound a ${a.config.id} window (one per app)`);
    const w = new WindowWorker(win, a, this.bridge, this.cache, this.differ, this.perception, this.llm, this.lock);
    this.workers.push(w); return w;
  }
  /** run every worker once, concurrently (perception parallel, input serialized by lock) */
  async tickAll() { return Promise.all(this.workers.map(w => w.tick())); }
  start(intervalMs = 5000) {
    const loop = async () => { await this.tickAll(); this.timer = setTimeout(loop, intervalMs); };
    loop();
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
}
