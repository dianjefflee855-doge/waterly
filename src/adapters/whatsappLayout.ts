import { FracRect } from './AppAdapter';
export interface LayoutEl { role: string; identifier?: string; frame: { x: number; y: number; w: number; h: number } }
export interface WaRegions { sidebar: FracRect; title: FracRect; messages: FracRect; input: FracRect; singlePane?: boolean }

/**
 * Derive WhatsApp (Mac native) regions from AX frames (screen points) relative to the window.
 * sidebar = chat list column (right of the nav rail, below the search bar), title = chat-pane nav bar,
 * messages = between nav bar and chat bar, input = chat bar row. Returns null if anchors are missing.
 */
export function deriveWhatsAppRegions(els: LayoutEl[], winBounds?: { x: number; y: number; w: number; h: number }): WaRegions | null {
  // prefer the AX window frame in the same snapshot (CG bounds may be stale right after a resize)
  const win = els.find(e => e.role === 'window')?.frame ?? winBounds;
  const id = (s: string) => els.filter(e => e.identifier === s).map(e => e.frame);
  const header = id('NavigationBar_HeaderViewButton')[0];
  const composer = id('ChatBar_ComposerTextView')[0];
  const navBars = id('WDSNavigationBar');
  if (!win || !header || !composer) return null;
  const chatNav = navBars.find(f => header.x >= f.x && header.x < f.x + f.w);
  const listNav = navBars.find(f => f !== chatNav && f.x + f.w <= header.x + 1);
  const rail = id('SidebarButton_Chats')[0];
  const list = id('ChatListView_TableView')[0];
  const table = id('ChatMessagesTableView')[0];
  // single-pane (narrow window): chat list hidden or fully covered by the chat pane
  const singlePane = !list || (!!table && list.x + list.w <= win.x + 1) || (!!table && table.x <= (list?.x ?? 0) + 5);
  const paneX = table?.x ?? chatNav?.x ?? header.x - 50;
  const listX = rail ? rail.x + rail.w + 10 : (listNav?.x ?? win.x);
  const listTop = listNav ? listNav.y + listNav.h : win.y + 0.1 * win.h;
  const navBottom = chatNav ? chatNav.y + chatNav.h : header.y + header.h + 10;
  const barTop = Math.min(...id('ChatBar_AttachMediaButton').map(f => f.y), composer.y) - 8;
  const fr = (x0: number, y0: number, x1: number, y1: number): FracRect => ({
    x: +((x0 - win.x) / win.w).toFixed(4), y: +((y0 - win.y) / win.h).toFixed(4),
    w: +((x1 - x0) / win.w).toFixed(4), h: +((y1 - y0) / win.h).toFixed(4) });
  const right = win.x + win.w, bottom = win.y + win.h;
  if (singlePane) return {
    sidebar: { x: 0, y: 0, w: 0, h: 0 }, singlePane: true,
    title: fr(paneX, win.y, right, navBottom), messages: fr(paneX, navBottom, right, barTop), input: fr(paneX, barTop, right, bottom) };
  return {
    sidebar: fr(listX, listTop, paneX, bottom),
    title: fr(paneX, win.y, right, navBottom),
    messages: fr(paneX, navBottom, right, barTop),
    input: fr(paneX, barTop, right, bottom),
  };
}

/** Tight window-relative rect (points) around the header avatar+name for OCR; the full-width title strip
 *  (very wide aspect ratio) makes the text detector fail. */
export function headerNameRect(els: LayoutEl[], win: { x: number; y: number }) {
  const h = els.find(e => e.identifier === 'NavigationBar_HeaderViewButton')?.frame; if (!h) return null;
  return { x: h.x - win.x, y: Math.max(0, h.y - win.y - 4), w: Math.max(h.w + 40, 260), h: h.h + 8 };
}
