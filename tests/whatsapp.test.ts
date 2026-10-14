import { describe, it, expect, vi } from 'vitest';
import { identifyWhatsAppWindow, headerMatches, sendWhatsApp, WhatsAppSendError } from '../src/adapters/whatsapp';
import { AccessibilityBridge, AxElement } from '../src/platform/Accessibility';
import { PlatformBridge } from '../src/platform/PlatformBridge';
import { WindowInfo, FocusState } from '../src/core/types';

const win: WindowInfo = { windowId: '42', pid: 7, bundleId: 'net.whatsapp.WhatsApp', title: 'WhatsApp', bounds: { x: 0, y: 0, w: 1200, h: 800 }, onScreen: true };
const composer: AxElement = { role: 'AXTextArea', description: '撰写消息', settable: true };

function mocks(o: { header?: string; composer?: boolean; stealAt?: 'paste' | 'key' } = {}) {
  const log: string[] = [];
  let focus: FocusState = { bundleId: 'x', pid: 1, windowId: null };
  const own = () => { focus = { bundleId: win.bundleId, pid: win.pid, windowId: win.windowId }; };
  const bridge = {
    raise: vi.fn(async () => { log.push('raise'); own(); }),
    getFocus: vi.fn(async () => ({ ...focus })),
    paste: vi.fn(async (t: string) => { log.push('paste:' + t); if (o.stealAt === 'paste') focus = { bundleId: 'com.other', pid: 9, windowId: '1' }; }),
    pressKey: vi.fn(async (k: string) => { log.push('key:' + k); }),
    restoreClipboard: vi.fn(async () => { log.push('restore'); }),
  } as unknown as PlatformBridge;
  let focused: AxElement | null = null;
  const ax: AccessibilityBridge = {
    find: async (_w, q) => q.identifier === 'NavigationBar_HeaderViewButton'
      ? [{ role: 'AXButton', identifier: q.identifier, description: (o.header ?? 'Alice') + '\n在线' }]
      : (o.composer !== false && q.description === '撰写消息') ? [composer] : [],
    focus: async (_w, el) => { focused = el; log.push('axfocus'); },
    focusedElement: async () => focused,
  };
  return { bridge, ax, log };
}

describe('WhatsApp adapter', () => {
  it('identifies the largest on-screen WhatsApp window', () => {
    const small = { ...win, windowId: '1', bounds: { x: 0, y: 0, w: 300, h: 300 } };
    const other = { ...win, windowId: '2', bundleId: 'ru.keepcoder.Telegram', bounds: { x: 0, y: 0, w: 2000, h: 2000 } };
    const hidden = { ...win, windowId: '3', onScreen: false, bounds: { x: 0, y: 0, w: 3000, h: 3000 } };
    expect(identifyWhatsAppWindow([small, other, hidden, win])?.windowId).toBe('42');
    expect(identifyWhatsAppWindow([other])).toBeUndefined();
  });
  it('header match is exact per line, not substring', () => {
    expect(headerMatches({ role: 'AXButton', description: 'Alice\n在线' }, 'Alice')).toBe(true);
    expect(headerMatches({ role: 'AXButton', description: 'Alice Wong' }, 'Alice')).toBe(false);
  });
  it('sends: raise, focus composer, paste, Enter, restore clipboard', async () => {
    const m = mocks();
    expect(await sendWhatsApp(m.bridge, m.ax, win, 'Alice', 'hi')).toBe('sent');
    expect(m.log).toEqual(['raise', 'axfocus', 'paste:hi', 'key:Return', 'restore']);
  });
  it('dry run never presses Enter', async () => {
    const m = mocks();
    expect(await sendWhatsApp(m.bridge, m.ax, win, 'Alice', 'hi', { dryRun: true })).toBe('dry_run');
    expect(m.log.some(l => l.startsWith('key:'))).toBe(false);
  });
  it('refuses wrong chat before pasting', async () => {
    const m = mocks({ header: 'Bob' });
    await expect(sendWhatsApp(m.bridge, m.ax, win, 'Alice', 'hi')).rejects.toMatchObject({ code: 'chat_mismatch' });
    expect(m.log).toEqual(['raise']);
  });
  it('refuses when composer missing', async () => {
    const m = mocks({ composer: false });
    await expect(sendWhatsApp(m.bridge, m.ax, win, 'Alice', 'hi')).rejects.toBeInstanceOf(WhatsAppSendError);
  });
  it('does not press Enter if focus stolen after paste', async () => {
    const m = mocks({ stealAt: 'paste' });
    await expect(sendWhatsApp(m.bridge, m.ax, win, 'Alice', 'hi')).rejects.toMatchObject({ code: 'focus_lost' });
    expect(m.log).toContain('restore');
    expect(m.log.some(l => l.startsWith('key:'))).toBe(false);
  });
});
