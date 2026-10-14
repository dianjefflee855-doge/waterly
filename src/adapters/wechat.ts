/**
 * WeChat for Mac (com.tencent.xinWeChat, Qt UI) adapter — AX-first. Observed identifiers:
 *   session_list (AXList) > session_item_<chat name> (title = "name\npreview\nHH:MM\n[flags]")
 *   current_chat_name_label (value = chat name), current_chat_count_label (value "(N)" for groups)
 *   chat_message_list (AXList) > chat_bubble_item_view (title = text / [type]), time separators, virtual_cell
 *   chat_input_field (AXTextArea, settable)
 */
export const WX_BUNDLES = ['com.tencent.xinWeChat'];
export const WX_FILE_HELPER = ['文件传输助手', 'File Transfer'];
const strip = (s: string) => (s ?? '').replace(/[\u200e\u200f\u2068\u2069]/g, '').trim();
export const wxNameEq = (a: string, b: string) => strip(a).replace(/\s+/g, '') === strip(b).replace(/\s+/g, '') && !!strip(b);

export interface WxSession { name: string; preview: string; lastSender?: string; time?: string; unread: number; muted: boolean; mentioned: boolean; y: number }
export function parseSession(identifier: string, title: string, y: number): WxSession {
  const name = identifier.replace(/^session_item_/, '');
  const lines = strip(title).split('\n').map(strip).filter(Boolean);
  const rest = lines[0] === name ? lines.slice(1) : lines.slice(1);
  const time = rest.find(l => /^(\d{1,2}:\d{2}|昨天|星期.|\d{1,2}\/\d{1,2}|\d{4}\/\d{1,2}\/\d{1,2}|\d{2}\/\d{1,2}\/\d{1,2})$/.test(l));
  // observed: "name\n已置顶\n[4条] \npreview\nHH:MM\n消息免打扰" — badge and flags can be on their own lines
  const isFlag = (l: string) => /^(已置顶|消息免打扰|\[\d+条\])$/.test(l);
  const unreadLine = rest.find(l => /^\[\d+条\]/.test(l));
  const preview = (rest.find(l => l !== time && !isFlag(l)) ?? '').replace(/^\[\d+条\]\s*/, '');
  const m = preview.match(/^([^:：]{1,40})[:：]\s/);
  const flags = rest.filter(l => l !== time && l !== preview).join(' ');
  const um = ((unreadLine ?? '') + ' ' + flags + ' ' + preview).match(/(\d+)\s*条(新消息|未读)|\[(\d+)条\]|未读\s*(\d+)/);
  return { name, preview, lastSender: m?.[1], time, y,
    unread: um ? +(um[1] ?? um[3] ?? um[4]) : 0,
    muted: /免打扰|已静音|muted/i.test(flags), mentioned: /\[有人@我\]|\[@所有人\]|有人@我/.test(preview) };
}
export function isWxGroup(countLabel?: string | null) { return !!countLabel && /^\(\d+\)$/.test(strip(countLabel)); }

export interface WxMsg { self: boolean | null; sender: string | null; text: string; mentions: string[]; kind: 'text' | 'media' | 'system' }
/** Bubble title -> message. In groups WeChat may prefix "name: text" or "name说:"; media shows as [图片]/[表情]/图片 etc. */
export function parseBubble(title: string, group: boolean, selfGuess: boolean | null): WxMsg {
  let t = strip(title); let sender: string | null = null;
  if (group) { const m = t.match(/^(.{1,40}?)(?:说)?[:：]\s*([\s\S]+)$/); if (m && !/^https?$/i.test(m[1])) { sender = m[1].trim(); t = m[2].trim(); } }
  const media = /^\[?(图片|表情|视频|语音|文件|链接|动画表情|小程序|位置|名片|聊天记录|Photo|Sticker|Video|Voice|File|Link)\]?$/i.test(t);
  const mentions = [...t.matchAll(/@([^\s@\u2005,，:：]+)/g)].map(m => m[1]);
  return { self: selfGuess, sender: selfGuess ? 'self' : sender, text: t, mentions, kind: media ? 'media' : 'text' };
}

/**
 * Self/other from the avatar position inside a message cell (cells span the full message-list width; AX gives no
 * children). Incoming: avatar square at the left edge; self: at the right edge. `occupied(x0,x1,y0,y1)` returns the
 * fraction of non-background pixels in a window-point rect.
 */
export function classifyCell(cell: { x: number; y: number; w: number; h: number }, occupied: (x0: number, x1: number, y0: number, y1: number) => number, visibleTop: number) {
  const y0 = Math.max(cell.y + 4, visibleTop), y1 = Math.min(cell.y + 44, cell.y + cell.h);
  if (y1 - y0 < 12) return { self: null as boolean | null, left: 0, right: 0 };
  const left = occupied(cell.x + 14, cell.x + 46, y0, y1), right = occupied(cell.x + cell.w - 46, cell.x + cell.w - 14, y0, y1);
  const self = right > 0.35 && right > left * 2 ? true : left > 0.35 && left > right * 2 ? false : null;
  return { self, left: +left.toFixed(2), right: +right.toFixed(2) };
}
/** Nickname strip for group incoming messages: right of the left avatar, top of the cell. */
export const nicknameRect = (cell: { x: number; y: number; w: number }) => ({ x: cell.x + 50, y: cell.y - 2, w: Math.min(360, cell.w * 0.6), h: 30 }); // padded: tight crops make the detector miss small grey text

/** Incremental inbox scan state: per-chat fingerprint (time + hash of preview; no message text stored). */
export function fingerprint(s: WxSession) { let h = 0; for (const ch of s.preview) h = (h * 31 + ch.charCodeAt(0)) | 0; return `${s.time ?? ''}#${h}#${s.unread}`; }
/** Stop when `stopAfter` consecutive (non-pinned-order) sessions match the previous scan's fingerprints. */
export function shouldStop(page: WxSession[], prev: Record<string, string> | null, streak: { n: number }, stopAfter = 6) {
  if (!prev) return false;
  for (const s of page) { if (prev[s.name] === fingerprint(s)) streak.n++; else streak.n = 0; }
  return streak.n >= stopAfter;
}
