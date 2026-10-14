import { describe, it, expect, vi } from 'vitest';
import { parseChatCell, scanInbox, unreadChats, orderChanges, parseBubbles, openChat, isGroupChat, senderOcrAgreement } from '../src/adapters/whatsappInbox';
import { WhatsAppSendError } from '../src/adapters/whatsapp';
const L = '\u200e';
describe('inbox scan', () => {
  it('parses unread / muted / pinned / mentioned', () => {
    const e = parseChatCell({ name: 'A组', value: `A组, ${L}Bob发来的消息, hi, 14:03, 3条未读消息, 已静音`, y: 10 });
    expect(e).toMatchObject({ name: 'A组', unread: 3, muted: true, time: '14:03' });
    expect(parseChatCell({ name: 'x', value: `${L}你的消息, ok, 12:57, ${L}已发送, 置顶`, y: 0 })).toMatchObject({ unread: 0, pinned: true, lastFromSelf: true });
    expect(parseChatCell({ name: 'y', value: 'y, 有人提及了你, 9:00, 2 unread', y: 0 })).toMatchObject({ unread: 2, mentioned: true });
  });
  it('lists unread and order changes', () => {
    const prev = scanInbox([{ name: 'a', value: '', y: 1 }, { name: 'b', value: '', y: 2 }]);
    const cur = scanInbox([{ name: 'b', value: 'b, 1条未读', y: 1 }, { name: 'a', value: '', y: 2 }]);
    expect(unreadChats(cur).map(c => [c.name, c.unread])).toEqual([['b', 1]]);
    expect(orderChanges(prev, cur)).toEqual(['b']);
  });
});
describe('group bubbles', () => {
  it('field 0 is the speaker; time/date/status trimmed; mentions', () => {
    const m = parseBubbles([`${L}Alice, 大家好 @Alex 看下, 10:01, ${L}10月13日`, `${L}Bob, 10:02, ${L}10月13日`,
      `${L}你的消息, @Alice 收到, 10:03, ${L}10月13日, ${L}已送达`], { group: true, myNames: ['Alex'] });
    expect(m.map(x => x.sender)).toEqual(['Alice', 'Bob', 'self']);
    expect(m[0]).toMatchObject({ text: '大家好 @Alex 看下', time: '10:01', mentions: ['Alex'], mentionsMe: true });
    expect(m[1].text).toBe('');
    expect(m[2]).toMatchObject({ self: true, mentions: ['Alice'], mentionsMe: false });
  });
  it('group format: repeated label, date-time, reply header, isolate marks', () => {
    const m = parseBubbles([
      `${L}Alice Wong发来的消息, ${L}Alice Wong发来的消息, 大家看下 @\u2068Alex W\u2069, 10月13日14:03, ${L}群组(Demo)成员`,
      `${L}回复 Bob.\n${L}Carol发来的消息, ${L}回复 Bob.\n${L}Carol发来的消息, ok, 10月13日14:05, ${L}x`,
      `${L}你的消息, 收到, 10月13日14:06, ${L}x, ${L}已读`,
    ], { group: true, myNames: ['Alex'] });
    expect(m.map(x => x.sender)).toEqual(['Alice Wong', 'Carol', 'self']);
    expect(m[0]).toMatchObject({ text: '大家看下 @Alex W', time: '10月13日14:03', mentionsMe: true });
    expect(m[1].text).toBe('ok');
  });
  it('1:1 has no sender', () => {
    expect(parseBubbles([`${L}李四, hi, 9:00, ${L}x`], { group: false })[0]).toMatchObject({ sender: null, text: 'hi' });
  });
  it('detects group vs 1:1', () => {
    expect(isGroupChat(['NavigationBar_VideoDropdownButton'])).toBe(true);
    expect(isGroupChat(['NavigationBar_VideoCallButton', 'NavigationBar_CallButton'])).toBe(false);
  });
  it('sender OCR agreement', () => {
    expect(senderOcrAgreement([{ sender: 'Alice W', self: false, top: { x: 100, y: 50 } }, { sender: 'Bob', self: false, top: { x: 100, y: 200 } }],
      [{ box: [104, 52, 200, 70], text: 'Alice W' }], 40)).toEqual({ incoming: 2, matched: 1 });
  });
});
describe('openChat', () => {
  const win = { windowId: '1', pid: 2, bundleId: 'net.whatsapp.WhatsApp', title: '', bounds: { x: 0, y: 0, w: 900, h: 700 }, onScreen: true };
  const mk = (header: string) => {
    const bridge: any = { raise: vi.fn(), getFocus: async () => ({ bundleId: win.bundleId, pid: 2, windowId: '1' }) };
    const ax: any = { openChat: vi.fn(async () => true), find: async () => [{ role: 'AXButton', description: header }] };
    return { bridge, ax };
  };
  it('opens and verifies header', async () => {
    const { bridge, ax } = mk('bob');
    await openChat(bridge, ax, win, [{ name: 'bob', value: '', y: 0 }], 'bob', 0);
    expect(ax.openChat).toHaveBeenCalledWith('1', 'bob');
  });
  it('aborts on duplicate / missing name and on header mismatch', async () => {
    const { bridge, ax } = mk('other');
    await expect(openChat(bridge, ax, win, [{ name: 'bob', value: '', y: 0 }, { name: 'bob', value: '', y: 1 }], 'bob', 0)).rejects.toBeInstanceOf(WhatsAppSendError);
    expect(ax.openChat).not.toHaveBeenCalled();
    await expect(openChat(bridge, ax, win, [{ name: 'bob', value: '', y: 0 }], 'bob', 0)).rejects.toMatchObject({ code: 'chat_mismatch' });
  });
});
