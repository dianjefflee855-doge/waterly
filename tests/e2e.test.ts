import { describe, it, expect, afterAll } from 'vitest';
import { FakePlatformBridge, chatSpec, MockLlm } from './helpers';
import { Scheduler } from '../src/scheduler/scheduler';
import { Perception } from '../src/perception/pipeline';
import { RapidOcrSidecar } from '../src/perception/ocr';
import { synthAdapterFor } from '../src/adapters/configs';

const ocr = new RapidOcrSidecar(); afterAll(() => ocr.close());
const setup = (specs: ReturnType<typeof chatSpec>[]) => {
  const b = new FakePlatformBridge(specs); const llm = new MockLlm();
  const s = new Scheduler(b, new Perception(ocr), llm);
  for (const sp of specs) s.bind(sp.info, synthAdapterFor(sp.info.bundleId));
  return { b, llm, s };
};

describe('e2e: unread -> open -> OCR -> LLM -> focus check -> paste+send', () => {
  const cases: [string, string, string][] = [
    ['telegram (native mac)', 'ru.keepcoder.Telegram', 'telegram'],
    ['telegram desktop', 'org.telegram.desktop', 'telegram'],
    ['whatsapp', 'net.whatsapp.WhatsApp', 'whatsapp'],
    ['wechat (secondary)', 'com.tencent.xinWeChat', 'wechat'],
  ];
  for (const [name, bundle, theme] of cases) {
    it(name, async () => {
      const { b, llm, s } = setup([chatSpec('w1', bundle, theme)]);
      await s.tickAll();
      const w = s.workers[0];
      expect(w.state).toBe('Idle');
      expect(b.events.find(e => e.type === 'click')).toMatchObject({ windowId: 'w1', x: 125 });
      expect(llm.calls).toEqual([{ app: w.adapter.config.displayName, contact: '李四', last: '我这边下午有空' }]);
      expect(b.sentMessages()).toEqual([{ windowId: 'w1', text: '下午三点可以' }]);
      expect(b.events.filter(e => e.type === 'key')[0]).toMatchObject({ combo: 'Return' });
      expect(w.log.map(l => l.to)).toEqual(['Opening', 'Reading', 'Thinking', 'WaitSendLock', 'Sending', 'Verifying', 'Idle']);
      expect(w.log[w.log.length - 1].note).toBe('sent+verified');
      // next tick: unchanged frame -> no OCR/LLM, no second send
      await s.tickAll(); expect(llm.calls).toHaveLength(1); expect(b.sentMessages()).toHaveLength(1);
    });
  }
});

describe('multi-app: 5 different apps, global input lock', () => {
  it('each app replies once into its own window, input never interleaved', async () => {
    const specs = [
      chatSpec('tg', 'ru.keepcoder.Telegram', 'telegram'), chatSpec('wa', 'net.whatsapp.WhatsApp', 'whatsapp'),
      chatSpec('wx', 'com.tencent.xinWeChat', 'wechat'), chatSpec('qq', 'com.tencent.qq', 'wechat'),
      chatSpec('wc', 'com.tencent.WeWorkMac', 'wechat'),
    ];
    const { b, s } = setup(specs);
    await s.tickAll();
    const sent = b.sentMessages();
    expect(sent.map(x => x.windowId).sort()).toEqual(['qq', 'tg', 'wa', 'wc', 'wx']);
    // after each raise, the following input events belong to that window until the next raise
    let cur: string | null = null;
    for (const e of b.events) {
      if (e.type === 'raise') cur = e.windowId;
      else if (e.type === 'click') expect(e.windowId).toBe(cur);
      else expect(e.focus.windowId).toBe(cur);
    }
  });
  it('rejects a 6th window and a second window of the same app', () => {
    const { s } = setup([chatSpec('tg', 'ru.keepcoder.Telegram', 'telegram')]);
    expect(() => s.bind(chatSpec('tg2', 'org.telegram.desktop', 'telegram').info)).toThrow(/one per app/);
    const s2 = setup(['a', 'b', 'c', 'd', 'e'].map((id, i) => chatSpec(id, ['ru.keepcoder.Telegram', 'net.whatsapp.WhatsApp', 'com.tencent.xinWeChat', 'com.tencent.qq', 'com.tencent.WeWorkMac'][i], 'wechat'))).s;
    expect(() => s2.bind(chatSpec('f', 'x.y', 'wechat').info)).toThrow(/max 5/);
  });
});

describe('pre-send focus verification', () => {
  it('focus stolen after raise: abort, nothing pasted; Error after 3 failures', async () => {
    const { b, s } = setup([chatSpec('tg', 'ru.keepcoder.Telegram', 'telegram')]);
    b.onAfterRaise = () => { b.focus = { bundleId: 'net.whatsapp.WhatsApp', pid: 9, windowId: 'other' }; };
    for (let i = 0; i < 3; i++) await s.tickAll();
    expect(b.events.filter(e => e.type === 'paste' || e.type === 'key' || e.type === 'click')).toHaveLength(0);
    expect(s.workers[0].state).toBe('Error');
    expect(s.workers[0].log.filter(l => /abort/.test(l.note ?? ''))).toHaveLength(3);
  });
  it('focus stolen between paste and send key: send key NOT pressed', async () => {
    const { b, s } = setup([chatSpec('wa', 'net.whatsapp.WhatsApp', 'whatsapp')]);
    const origPaste = b.paste.bind(b);
    b.paste = async (t: string) => { await origPaste(t); b.focus = { bundleId: 'com.apple.Safari', pid: 3, windowId: 's' }; };
    await s.tickAll();
    expect(b.events.filter(e => e.type === 'paste')).toHaveLength(1);
    expect(b.events.filter(e => e.type === 'key')).toHaveLength(0);
    expect(s.workers[0].log.some(l => /before send key/.test(l.note ?? ''))).toBe(true);
  });
  it('same app but different window (same pid) is rejected', async () => {
    const { b, s } = setup([chatSpec('tg', 'ru.keepcoder.Telegram', 'telegram')]);
    const w = s.workers[0].win;
    b.onAfterRaise = () => { b.focus = { bundleId: w.bundleId, pid: w.pid, windowId: 'tg-other-window' }; };
    await s.tickAll();
    expect(b.events.filter(e => e.type === 'click' || e.type === 'paste')).toHaveLength(0);
  });
});
