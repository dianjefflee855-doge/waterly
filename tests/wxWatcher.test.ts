import { describe, it, expect } from 'vitest';
import { WxWatcher } from '../src/core/wxWatcher';
describe('WxWatcher', () => {
  it('scan fallback emits once per change; banner hints attach', async () => {
    let list = [{ name: 'a', unread: 1, preview: 'x', time: '15:00' }]; const ev: any[] = [];
    const w = new WxWatcher({ listTop: () => list, now: () => 0 }, e => ev.push(e));
    await w.scan('scan'); await w.scan('scan'); expect(ev.length).toBe(1);
    w.onBanner({ app: '微信', bundleId: 'com.tencent.xinWeChat', conversation: 'a', body: 'y', receivedAt: '', raw: { texts: [], desc: [] } });
    list = [{ name: 'a', unread: 2, preview: 'y', time: '15:01' }]; await w.scan('banner');
    expect(ev[1]).toMatchObject({ unread: 2, source: 'banner', bannerHints: ['y'] });
  });
});
