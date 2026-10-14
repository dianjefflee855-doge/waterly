import { describe, it, expect } from 'vitest';
import { MacPlatformBridge } from '../src/platform/mac/MacPlatformBridge';
describe('MacPlatformBridge (mock runner)', () => {
  const calls: string[][] = [];
  const run = (a: string[]) => { calls.push(a);
    if (a[0] === 'focusstate') return '{"bundleId":"net.whatsapp.WhatsApp","pid":9,"windowId":"5"}';
    if (a[0] === 'windows') return '[{"windowId":"5","pid":9,"bundleId":"net.whatsapp.WhatsApp","title":"","onScreen":true,"bounds":{"X":0,"Y":0,"Width":900,"Height":700}}]';
    return '{"ok":true}'; };
  it('refuses Return/Enter by default', async () => {
    const b = new MacPlatformBridge(run);
    await expect(b.pressKey('Return')).rejects.toThrow(/refused/);
    await expect(b.pressKey('Cmd+Enter')).rejects.toThrow(/refused/);
    expect(calls.some(c => c[0] === 'key' && /return|enter/i.test(c[2]))).toBe(false);
  });
  it('maps windows and pastes with clipboard save/restore', async () => {
    const b = new MacPlatformBridge(run);
    const w = await b.enumerateWindows(['net.whatsapp.WhatsApp']);
    expect(w[0].bounds).toEqual({ x: 0, y: 0, w: 900, h: 700 });
    calls.length = 0; await b.paste('x'); await b.restoreClipboard();
    expect(calls.map(c => c[0])).toEqual(['focusstate', 'clipsave', 'clipset', 'key', 'cliprestore']);
  });
});
import { PNG } from 'pngjs'; import * as fs from 'fs';
describe('MacPlatformBridge.capture', () => {
  it('captures by window id via screencapture -l and crops region', async () => {
    let args: string[] = [];
    const b = new MacPlatformBridge(() => '{}', {}, a => { args = a; const p = new PNG({ width: 20, height: 10 }); fs.writeFileSync(a[a.length - 1], PNG.sync.write(p)); });
    const f = await b.capture('123', { x: 2, y: 2, w: 5, h: 4 });
    expect(args).toContain('-l123'); expect([f.width, f.height]).toEqual([5, 4]);
    await expect(b.capture('1; rm', undefined)).rejects.toThrow();
  });
});
