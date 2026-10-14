import { describe, it, expect, afterAll } from 'vitest';
import { FakePlatformBridge, FX, win } from './helpers';
import { CaptureCache, FrameDiffer } from '../src/perception/frameDiff';
import { Perception } from '../src/perception/pipeline';
import { RapidOcrSidecar } from '../src/perception/ocr';
import { TelegramAdapter, WeChatAdapter, synthAdapterFor } from '../src/adapters/configs';
const WhatsAppAdapter = class { constructor() { return synthAdapterFor('net.whatsapp.WhatsApp')!; } } as unknown as new () => import('../src/adapters/AppAdapter').AppAdapter;
import * as path from 'path';

const ocr = new RapidOcrSidecar();
afterAll(() => ocr.close());
const P = new Perception(ocr);
const apps = [['telegram', new TelegramAdapter()], ['whatsapp', new WhatsAppAdapter()], ['wechat', new WeChatAdapter()]] as const;

async function frame(app: string, f: string) {
  const b = new FakePlatformBridge([{ info: win('w', 'x'), frames: [FX(app, f)] }]); return b.capture('w');
}

describe('unread badge HSV detection', () => {
  for (const [app, a] of apps) {
    it(`${app}: none on idle, 1 on unread, 2 on two_unread; not fooled by selected row`, async () => {
      expect(P.unread(a, await frame(app, 'idle.png'))).toHaveLength(0);
      const one = P.unread(a, await frame(app, 'unread_sidebar.png'));
      expect(one).toHaveLength(1); expect(Math.round(one[0].cy)).toBeGreaterThan(90); expect(Math.round(one[0].cy)).toBeLessThan(115);
      expect(P.unread(a, await frame(app, 'two_unread.png'))).toHaveLength(2);
      expect(P.unread(a, await frame(app, 'opened_lisi.png'))).toHaveLength(0);
    });
  }
  it('badge colours are app-specific (telegram badge not detected by whatsapp config)', async () => {
    expect(P.unread(new WhatsAppAdapter(), await frame('telegram', 'unread_sidebar.png'))).toHaveLength(0);
    expect(P.unread(new WeChatAdapter(), await frame('whatsapp', 'unread_sidebar.png'))).toHaveLength(0);
  });
});

describe('frame diff + 100ms capture cache', () => {
  it('caches within ttl and dedupes concurrent captures', async () => {
    let t = 1000; const b = new FakePlatformBridge([{ info: win('w', 'x'), frames: [FX('telegram', 'idle.png')] }]);
    const c = new CaptureCache(b, 100, () => t);
    await Promise.all([c.get('w'), c.get('w'), c.get('w')]); expect(b.captures).toBe(1);
    t += 50; await c.get('w'); expect(b.captures).toBe(1);
    t += 100; await c.get('w'); expect(b.captures).toBe(2);
  });
  it('unchanged frame => skip; changed => process', async () => {
    const d = new FrameDiffer();
    const a = await frame('telegram', 'idle.png'), a2 = await frame('telegram', 'idle.png'), u = await frame('telegram', 'unread_sidebar.png');
    expect(d.changed('w', a)).toBe(true); expect(d.changed('w', a2)).toBe(false); expect(d.changed('w', u)).toBe(true);
  });
});

describe('RapidOCR sidecar messages + speaker', () => {
  it('bench synth_chat.png: 7 messages, alternating speakers', async () => {
    const lines = await ocr.recognize(path.resolve(__dirname, '../fixtures/synth_chat.png'));
    const a = new WeChatAdapter();
    // synth_chat has no sidebar: treat whole image as message area
    a.config = { ...a.config, regions: { ...a.config.regions, messages: { x: 0, y: 0, w: 1, h: 1 } } };
    const m = a.parseMessages(lines, 900, 700);
    expect(m).toHaveLength(7);
    expect(m.map(x => x.speaker)).toEqual(['other', 'self', 'other', 'self', 'other', 'self', 'other']);
    expect(m[0].text).toContain('还有货');
    console.log('OCR latency ms', ocr.lastMs);
  });
  for (const [app, a] of apps) {
    it(`${app}: title + messages from opened chat`, async () => {
      const f = await frame(app, 'opened_lisi.png');
      expect(await P.title(a, f)).toBe('李四');
      const m = await P.messages(a, f);
      expect(m.map(x => [x.speaker, x.text])).toEqual([['other', '在吗？明天几点开会'], ['other', '我这边下午有空']]);
      const m2 = await P.messages(a, await frame(app, 'after_send_lisi.png'));
      expect(m2[m2.length - 1]).toMatchObject({ speaker: 'self', text: '下午三点可以' });
    });
  }
});
import { RapidOcrSidecar as Sc } from '../src/perception/ocr';
import { describe as d2, it as i2, expect as e2 } from 'vitest';
d2('sidecar crash handling', () => {
  i2('rejects pending requests instead of hanging when the sidecar dies, then restarts', async () => {
    const os = await import('os'); const fs = await import('fs'); const path = await import('path');
    const crash = path.join(os.tmpdir(), 'crash_sidecar.py');
    fs.writeFileSync(crash, 'import sys,json,os\nprint(json.dumps({"ready":True}),flush=True)\nsys.stdin.readline()\nos._exit(3)  # plain exit: a real SIGSEGV would pop a macOS crash dialog\n');
    const s = new Sc('python3', crash);
    await e2(s.recognize('x.png')).rejects.toThrow(/exited|signal/);
    await e2(s.recognize('x.png')).rejects.toThrow(/exited|signal/); // restarted, crashed again, still no hang
    await s.close();
  });
});
