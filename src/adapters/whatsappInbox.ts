import { PlatformBridge, verifyFocus } from '../platform/PlatformBridge';
import { AccessibilityBridge } from '../platform/Accessibility';
import { WindowInfo } from '../core/types';
import { assertChatHeader, WhatsAppSendError } from './whatsapp';

const strip = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();

/** One chat-list cell as read from AX: description = chat name, value = comma-joined summary. */
export interface RawCell { name: string; value: string; y: number; selected?: boolean }
export interface ChatEntry { name: string; selected: boolean; unread: number; markedUnread: boolean; muted: boolean; pinned: boolean; mentioned: boolean; lastFromSelf: boolean; time?: string; y: number }

const UNREAD = [/(\d+)\s*条未读/, /(\d+)\s*unread/i, /未读消息\s*(\d+)/];
export function parseChatCell(c: RawCell): ChatEntry {
  const v = strip(c.value);
  const parts = v.split(/,\s*/).map(strip);
  let unread = 0;
  for (const r of UNREAD) { const m = v.match(r); if (m) { unread = +m[1]; break; } }
  const markedUnread = !unread && /标为未读|未读|unread/i.test(v);
  const time = parts.find(p => /^(\d{1,2}:\d{2}|\d{4}年\d{1,2}月\d{1,2}日\d{1,2}:\d{2}|昨天|星期.)$/.test(p));
  return { name: strip(c.name), selected: !!c.selected, unread, markedUnread, muted: /已静音|静音|muted/i.test(v), pinned: /置顶|pinned/i.test(v),
    mentioned: /提及了你|@你|mentioned you/i.test(v), lastFromSelf: parts[0] === '你的消息', time, y: c.y };
}
export function scanInbox(cells: RawCell[]): ChatEntry[] { return cells.map(parseChatCell).sort((a, b) => a.y - b.y); }
export function unreadChats(list: ChatEntry[]) { return list.filter(c => c.unread > 0 || c.markedUnread); }
/** Names that moved up (or newly appeared) vs previous scan — new activity signal. */
export function orderChanges(prev: ChatEntry[], cur: ChatEntry[]): string[] {
  const p = new Map(prev.map((c, i) => [c.name, i]));
  return cur.filter((c, i) => !p.has(c.name) || i < p.get(c.name)!).map(c => c.name);
}
/** Cross-check: OCR/colour badge count in sidebar vs AX unread chats. */
export function crossCheck(axUnread: number, badgeCount: number) { return { axUnread, badgeCount, agree: axUnread === badgeCount }; }

export interface ChatOpener { openChat(windowId: string, name: string): Promise<boolean> }
/** Open a chat: name must exist exactly once in list; then header must match, else abort. */
export async function openChat(bridge: PlatformBridge, ax: AccessibilityBridge & ChatOpener, win: WindowInfo, cells: RawCell[], name: string, settleMs = 600) {
  const n = cells.filter(c => strip(c.name) === strip(name)).length;
  if (n !== 1) throw new WhatsAppSendError('chat_mismatch', `list item "${name}" matches ${n}`);
  await bridge.raise(win.windowId);
  if (!(await verifyFocus(bridge, win))) throw new WhatsAppSendError('focus_lost', 'focus lost after raise');
  if (!(await ax.openChat(win.windowId, name))) throw new WhatsAppSendError('chat_mismatch', 'press failed');
  await new Promise(r => setTimeout(r, settleMs));
  await assertChatHeader(ax, win, name);
}

/** Group vs 1:1 from AX: 1:1 header bar has separate VideoCall+Call buttons; groups have a video dropdown
 *  and the header button carries a member-list value. */
export function isGroupChat(layoutIds: string[], headerValue?: string): boolean {
  if (layoutIds.includes('NavigationBar_VideoDropdownButton')) return true;
  if (layoutIds.includes('NavigationBar_CallButton') && layoutIds.includes('NavigationBar_VideoCallButton')) return false;
  return !!headerValue && headerValue.length > 0;
}

/**
 * Bubble AX description format (WhatsApp Mac, observed on zh-Hans UI):
 *   1:1 self:    "‎你的消息, <text…>, HH:MM, ‎<date>, ‎<status>"
 *   1:1 in:      "‎<label>, <text…>, HH:MM, ‎<date>"
 *   group in:    "‎<Name>发来的消息, ‎<Name>发来的消息, <text…>, <M月D日HH:MM>, ‎<group info>"   (label repeated)
 *   reply/quote: field 0 is multi-line; the LAST line is the speaker label.
 */
export interface GroupMsg { self: boolean; sender: string | null; text: string; time?: string; mentions: string[]; mentionsMe: boolean }
const SELF = /^(你的消息|your message)$/i;
const TIME_FIELD = (p: string) => p.length <= 20 && /\d{1,2}:\d{2}$/.test(p);
export function speakerFromLabel(label: string): string {
  const last = label.split('\n').map(strip).filter(Boolean).pop() ?? '';
  return last.replace(/(发来的消息|的消息|'s message|’s message)$/i, '').trim();
}
export function parseBubbles(descs: string[], opts: { group: boolean; myNames?: string[] }): GroupMsg[] {
  return descs.map(d => {
    const raw = d.split(/, /);
    const parts = raw.map(p => p.split('\n').map(strip).join('\n').trim());
    const lastLine = parts[0].split('\n').map(strip).filter(Boolean).pop() ?? '';
    const self = SELF.test(lastLine);
    const label = speakerFromLabel(parts[0]);
    let ti = parts.findIndex((p, i) => i > 0 && TIME_FIELD(p));
    const body = parts.slice(1, ti > 0 ? ti : parts.length).filter(p => p !== parts[0]);
    const sender = self ? 'self' : (opts.group ? label || null : null);
    const rawText = body.join(', ');
    // WhatsApp wraps mention names in U+2068…U+2069 (FSI/PDI); fall back to a single token otherwise
    const mentions = [...rawText.matchAll(/@(?:\u2068([^\u2069]+)\u2069|([^\s@,，:：\u2068]+))/g)].map(m => (m[1] ?? m[2]).trim());
    const text = rawText.replace(/[\u2068\u2069]/g, '');
    const me = opts.myNames ?? [];
    return { self, sender, text, time: ti > 0 ? parts[ti] : undefined, mentions,
      mentionsMe: mentions.some(m => me.some(n => m === n || m.startsWith(n))) || /@你/.test(text) };
  });
}
/** Cross-check: fraction of incoming group bubbles whose sender name appears in an OCR line at the bubble's top band. */
export function senderOcrAgreement(msgs: { sender: string | null; self: boolean; top: { x: number; y: number } }[],
  lines: { box: [number, number, number, number]; text: string }[], band: number) {
  const n = (s: string) => s.replace(/[\s\u200e~]/g, '').toLowerCase();
  // WhatsApp only draws the name on the first bubble of a run from the same sender
  const inc = msgs.filter((m, i) => !m.self && m.sender && (i === 0 || msgs[i - 1].sender !== m.sender));
  const hit = inc.filter(m => lines.some(l => l.box[1] >= m.top.y - 6 && l.box[1] <= m.top.y + band && l.box[0] >= m.top.x - 10 &&
    (n(l.text).startsWith(n(m.sender!).slice(0, 4)) || n(m.sender!).startsWith(n(l.text).slice(0, 4)))));
  return { incoming: inc.length, matched: hit.length };
}
