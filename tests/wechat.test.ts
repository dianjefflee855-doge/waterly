import { describe, it, expect } from 'vitest';
import { parseSession, isWxGroup, parseBubble, wxNameEq } from '../src/adapters/wechat';
describe('wechat', () => {
  it('session item', () => {
    const s = parseSession('session_item_南京', '南京\n小王: @Alex 看下\n14:03\n消息免打扰\n', 0);
    expect(s).toMatchObject({ name: '南京', lastSender: '小王', time: '14:03', muted: true, unread: 0 });
    expect(parseSession('session_item_a', 'a\n[3条] 张三: hi\n昨天\n', 0).unread).toBe(3);
    expect(parseSession('session_item_x', 'x\n已置顶\n[4条] \n出门没耳机\n15:09\n', 0)).toMatchObject({ unread: 4, preview: '出门没耳机', time: '15:09' });
    expect(parseSession('session_item_y', 'y\n[2条] 哈基米: 求问\n15:05\n消息免打扰\n', 0)).toMatchObject({ unread: 2, lastSender: '哈基米', muted: true });
    expect(parseSession('session_item_a', 'a\n[有人@我] 张三: hi\n09:00\n', 0).mentioned).toBe(true);
  });
  it('group / bubble', () => {
    expect(isWxGroup('(999)')).toBe(true); expect(isWxGroup(null)).toBe(false);
    expect(parseBubble('张三: 大家好 @Alex', true, false)).toMatchObject({ sender: '张三', text: '大家好 @Alex', mentions: ['Alex'] });
    expect(parseBubble('图片', true, false).kind).toBe('media');
    expect(parseBubble('https://x.y', true, false).sender).toBeNull();
    expect(wxNameEq('文件传输助手', ' 文件传输助手')).toBe(true);
  });
});
import { classifyCell, shouldStop, fingerprint } from '../src/adapters/wechat';
describe('wechat cell + incremental', () => {
  const cell = { x: 0, y: 100, w: 800, h: 80 };
  it('avatar side', () => {
    expect(classifyCell(cell, (x0) => (x0 < 100 ? 0.9 : 0.02), 0).self).toBe(false);
    expect(classifyCell(cell, (x0) => (x0 > 700 ? 0.8 : 0.0), 0).self).toBe(true);
    expect(classifyCell(cell, () => 0.0, 0).self).toBeNull();
    expect(classifyCell(cell, () => 0.9, 170).self).toBeNull(); // avatar scrolled out of view
  });
  it('incremental stop', () => {
    const mk = (n: string, t: string) => ({ name: n, preview: 'p', time: t, unread: 0, muted: false, mentioned: false, y: 0 });
    const prev = Object.fromEntries(['a', 'b', 'c'].map(n => [n, fingerprint(mk(n, '1:00'))]));
    const st = { n: 0 };
    expect(shouldStop([mk('x', '2:00'), mk('a', '1:00')], prev, st, 3)).toBe(false);
    expect(shouldStop([mk('b', '1:00'), mk('c', '1:00')], prev, st, 3)).toBe(true);
    expect(shouldStop([mk('a', '1:00')], null, { n: 0 })).toBe(false);
  });
});
