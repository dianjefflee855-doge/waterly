import * as path from 'path';
import { FakePlatformBridge, FakeWindowSpec } from '../src/platform/fake/FakePlatformBridge';
import { WindowInfo } from '../src/core/types';
import { LlmClient } from '../src/llm/minimax';
export const FX = (app: string, f: string) => path.resolve(__dirname, '../fixtures', app, f);
let pid = 100;
export function win(id: string, bundleId: string): WindowInfo {
  return { windowId: id, pid: pid++, bundleId, title: id, bounds: { x: 0, y: 0, w: 900, h: 700 }, onScreen: true };
}
export function chatSpec(id: string, bundleId: string, theme: string): FakeWindowSpec {
  return { info: win(id, bundleId), frames: [FX(theme, 'unread_sidebar.png'), FX(theme, 'opened_lisi.png'), FX(theme, 'after_send_lisi.png')], advanceOnClick: true, advanceOnSend: true };
}
export class MockLlm implements LlmClient {
  calls: { app: string; contact: string; last: string }[] = [];
  async reply(h: any[], ctx: { app: string; contact: string }) { this.calls.push({ ...ctx, last: h[h.length - 1]?.text }); return '下午三点可以'; }
}
export { FakePlatformBridge };
