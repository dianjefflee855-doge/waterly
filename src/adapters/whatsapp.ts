import { PlatformBridge, verifyFocus } from '../platform/PlatformBridge';
import { AccessibilityBridge, AxElement } from '../platform/Accessibility';
import { WindowInfo } from '../core/types';
import { WHATSAPP } from './configs';

/** WhatsApp (macOS native app) AX selectors. Observed on a test Mac (zh-Hans UI); verify per locale. */
export const WHATSAPP_AX = {
  bundleIds: WHATSAPP.bundleIds,
  header: { identifier: 'NavigationBar_HeaderViewButton' },
  composer: { identifier: 'ChatBar_ComposerTextView' },
  composerDescriptions: ['撰写消息', 'Compose message', 'Type a message'],
  pasteKey: WHATSAPP.pasteKey,
  sendKey: WHATSAPP.sendKey,
};

export class WhatsAppSendError extends Error {
  constructor(public code: 'no_window' | 'chat_mismatch' | 'no_composer' | 'focus_lost' | 'composer_not_focused', msg: string) { super(msg); }
}

/** Pick the WhatsApp main window: right bundle, on screen, largest area. */
export function identifyWhatsAppWindow(wins: WindowInfo[]): WindowInfo | undefined {
  return wins.filter(w => WHATSAPP_AX.bundleIds.includes(w.bundleId) && w.onScreen && w.bounds.w > 200 && w.bounds.h > 200)
    .sort((a, b) => b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h)[0];
}

const norm = (s: string) => s.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim();
/** OCR-tolerant compare: ignores whitespace (OCR renders 'ab测试群' as 'ab 测试群'). */
export const ocrNameEquals = (a: string, b: string) => !!b && norm(a).replace(/\s+/g, '') === norm(b).replace(/\s+/g, '');
/** Header button text holds the chat name (may be followed by status lines like "在线"). */
export function headerMatches(el: AxElement, expected: string): boolean {
  const txt = norm([el.title, el.description, el.value].filter(Boolean).join('\n'));
  const want = norm(expected);
  return !!want && txt.split(/\n|,|，/).map(norm).some(l => l === want);
}

export async function assertChatHeader(ax: AccessibilityBridge, win: WindowInfo, expected: string) {
  const els = await ax.find(win.windowId, WHATSAPP_AX.header);
  if (!els.some(e => headerMatches(e, expected)))
    throw new WhatsAppSendError('chat_mismatch', `header is not "${expected}"`);
}

export async function locateComposer(ax: AccessibilityBridge, win: WindowInfo): Promise<AxElement> {
  const byId = (await ax.find(win.windowId, WHATSAPP_AX.composer)).filter(e => e.settable !== false);
  if (byId.length) return byId[0];
  for (const d of WHATSAPP_AX.composerDescriptions) {
    const c = (await ax.find(win.windowId, { description: d })).filter(e => e.settable !== false);
    if (c.length) return c[0];
  }
  throw new WhatsAppSendError('no_composer', 'composer not found');
}

/**
 * Raise -> verify focus -> assert chat header -> focus composer -> verify -> paste -> verify -> Enter.
 * Uses only OS-level input (clipboard + key events); nothing is injected into WhatsApp.
 * dryRun stops before the Enter key (text stays in composer, unsent).
 */
export async function sendWhatsApp(bridge: PlatformBridge, ax: AccessibilityBridge, win: WindowInfo,
  expectedChat: string, text: string, opts: { dryRun?: boolean } = {}): Promise<'sent' | 'dry_run'> {
  const check = async (stage: string) => {
    if (!(await verifyFocus(bridge, win))) throw new WhatsAppSendError('focus_lost', `focus lost ${stage}`);
  };
  await bridge.raise(win.windowId);
  await check('after raise');
  await assertChatHeader(ax, win, expectedChat);
  const composer = await locateComposer(ax, win);
  await ax.focus(win.windowId, composer);
  const f = await ax.focusedElement(win.windowId);
  if (!f || norm(f.description ?? '') !== norm(composer.description ?? '') || f.identifier !== composer.identifier) throw new WhatsAppSendError('composer_not_focused', 'composer not focused');
  await check('before paste');
  try {
    await bridge.paste(text);
    await check('before send key (text pasted, not sent)');
    await assertChatHeader(ax, win, expectedChat);
    if (opts.dryRun) return 'dry_run';
    await bridge.pressKey(WHATSAPP_AX.sendKey);
    return 'sent';
  } finally { await bridge.restoreClipboard(); }
}
