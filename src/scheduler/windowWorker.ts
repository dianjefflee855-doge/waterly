import { AppAdapter } from '../adapters/AppAdapter';
import { ChatMessage, WindowInfo } from '../core/types';
import { PlatformBridge, verifyFocus } from '../platform/PlatformBridge';
import { CaptureCache, FrameDiffer } from '../perception/frameDiff';
import { Perception } from '../perception/pipeline';
import { LlmClient } from '../llm/minimax';
import { InputLock } from './inputLock';

export type WState = 'Idle' | 'Opening' | 'Reading' | 'Thinking' | 'WaitSendLock' | 'Sending' | 'Verifying' | 'Paused' | 'Error';
export interface WorkerLog { t: number; windowId: string; from: WState; to: WState; note?: string }

export class FocusMismatchError extends Error {}

export class WindowWorker {
  state: WState = 'Idle';
  focusFailures = 0;
  lastReplied = new Map<string, string>(); // contact -> last 'other' text we answered
  log: WorkerLog[] = [];
  sentCount = 0;
  constructor(
    public win: WindowInfo, public adapter: AppAdapter, private bridge: PlatformBridge,
    private cache: CaptureCache, private differ: FrameDiffer, private perception: Perception,
    private llm: LlmClient, private lock: InputLock, public maxFocusFailures = 3,
  ) {}
  private go(to: WState, note?: string) { this.log.push({ t: Date.now(), windowId: this.win.windowId, from: this.state, to, note }); this.state = to; }

  /** raise + verify focus, inside the global lock; throws FocusMismatchError */
  private async focused<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock.run(this.win.windowId, async () => {
      await this.bridge.raise(this.win.windowId);
      if (!(await verifyFocus(this.bridge, this.win))) throw new FocusMismatchError('focus mismatch after raise');
      return fn();
    });
  }

  /** one scheduling step; returns true if it did work */
  async tick(): Promise<boolean> {
    if (this.state === 'Error' || this.state === 'Paused') return false;
    try { return await this.step(); }
    catch (e: any) {
      if (e instanceof FocusMismatchError) {
        this.focusFailures++;
        this.go(this.focusFailures >= this.maxFocusFailures ? 'Error' : 'Idle', 'abort: ' + e.message);
        this.cache.invalidate(this.win.windowId); this.differ.reset(this.win.windowId); // re-examine next tick
        return false;
      }
      this.go('Error', String(e?.message ?? e)); return false;
    }
  }

  private async step(): Promise<boolean> {
    const f = await this.cache.get(this.win.windowId);
    if (!this.differ.changed(this.win.windowId, f)) return false; // nothing changed -> no OCR / LLM
    const badges = this.perception.unread(this.adapter, f);
    if (badges.length) {
      this.go('Opening', `${badges.length} unread`);
      const b = badges[0];
      const sb = this.adapter.toPx(this.adapter.config.regions.sidebar, f.width, f.height);
      await this.focused(() => this.bridge.click(this.win.windowId, Math.round(sb.x + sb.w / 2), Math.round(b.cy)));
      this.cache.invalidate(this.win.windowId);
    }
    this.go('Reading');
    const fr = await this.cache.get(this.win.windowId);
    this.differ.changed(this.win.windowId, fr);
    const [contact, msgs] = await Promise.all([this.perception.title(this.adapter, fr), this.perception.messages(this.adapter, fr)]);
    const last = msgs[msgs.length - 1];
    if (!last || last.speaker !== 'other' || this.lastReplied.get(contact) === last.text) { this.go('Idle', 'nothing to reply'); return true; }
    this.go('Thinking');
    const reply = await this.llm.reply(msgs, { app: this.adapter.config.displayName, contact });
    this.go('WaitSendLock');
    await this.send(reply);
    this.lastReplied.set(contact, last.text);
    this.go('Verifying');
    this.cache.invalidate(this.win.windowId);
    const after = await this.cache.get(this.win.windowId);
    this.differ.changed(this.win.windowId, after);
    const am = await this.perception.messages(this.adapter, after);
    const ok = am.length > 0 && am[am.length - 1].speaker === 'self';
    this.go('Idle', ok ? 'sent+verified' : 'sent, verify failed');
    return true;
  }

  private async send(text: string) {
    await this.lock.run(this.win.windowId, async () => {
      this.go('Sending');
      await this.bridge.raise(this.win.windowId);
      if (!(await verifyFocus(this.bridge, this.win))) throw new FocusMismatchError('focus mismatch before paste');
      await this.bridge.paste(text);
      if (!(await verifyFocus(this.bridge, this.win))) throw new FocusMismatchError('focus mismatch before send key (text pasted, not sent)');
      await this.bridge.pressKey(this.adapter.config.sendKey);
      await this.bridge.restoreClipboard();
      this.sentCount++; this.focusFailures = 0;
    });
  }
}
