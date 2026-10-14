import { describe, it, expect } from 'vitest';
import { parseBanner } from '../src/platform/mac/notifications';
describe('parseBanner', () => {
  it('real wechat banner', () => expect(parseBanner({ ts: 't', desc: ['微信 🥰我媳妇宇宙最可爱🥰, 买蓝色'], texts: ['🥰我媳妇宇宙最可爱🥰', '买蓝色'], ids: ['X', 'title', 'body'] })).toMatchObject({ bundleId: 'com.tencent.xinWeChat', conversation: '🥰我媳妇宇宙最可爱🥰', body: '买蓝色' }));
  it('real telegram banner not wechat', () => expect(parseBanner({ ts: 't', desc: ['Telegram calling → x, hi'], texts: ['calling → x', 'hi'] })?.bundleId).toBe('ru.keepcoder.Telegram'));
  it('group', () => expect(parseBanner({ ts: 't', texts: ['微信', 'Lody群', '哈基米: 你好'], desc: [] })).toMatchObject({ conversation: 'Lody群', sender: '哈基米', body: '你好', isGroup: true }));
  it('1:1', () => expect(parseBanner({ ts: 't', texts: ['微信', '张三', '宝宝'], desc: [] })).toMatchObject({ conversation: '张三', body: '宝宝', sender: undefined }));
  it('other app ignored', () => expect(parseBanner({ ts: 't', texts: ['邮件', 'x'], desc: [] })).toBeNull());
});
