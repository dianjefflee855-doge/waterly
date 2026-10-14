import { AppConfig, BaseAdapter, AppAdapter } from './AppAdapter';

// Default geometry tuned to our synthetic fixtures (sidebar ≈ 28% width). MUST be recalibrated
// against real screenshots on the Mac (D2/D3). Colours are approximations of each app's badge.
export const SYNTH_GEO = {
  sidebar: { x: 0, y: 0, w: 0.277, h: 1 },
  title: { x: 0.278, y: 0, w: 0.72, h: 0.07 },
  messages: { x: 0.278, y: 0.072, w: 0.72, h: 0.8 },
  input: { x: 0.278, y: 0.88, w: 0.72, h: 0.12 },
};
const TIME = /^(\d{1,2}:\d{2}|昨天|星期.|Yesterday|Today)/;

export const TELEGRAM: AppConfig = {
  id: 'telegram', displayName: 'Telegram', status: 'implemented',
  // ru.keepcoder.Telegram = native macOS "Telegram for macOS"; org.telegram.desktop = Telegram Desktop (Qt)
  bundleIds: ['ru.keepcoder.Telegram', 'org.telegram.desktop'],
  regions: SYNTH_GEO,
  // unmuted unread badge is blue (~#3390EC); muted is grey (ignored). Selected row is also blue but large -> maxArea filters it.
  unreadBadge: { hsv: [{ hMin: 200, hMax: 220, sMin: 0.6, sMax: 1, vMin: 0.75, vMax: 1 }], minArea: 60, maxArea: 1500 },
  bubbles: { selfSide: 'right', splitFrac: 0.5, minScore: 0.5 },
  pasteKey: 'Cmd+V', sendKey: 'Return', ignorePatterns: [TIME],
};
export const WHATSAPP: AppConfig = {
  id: 'whatsapp', displayName: 'WhatsApp', status: 'implemented',
  bundleIds: ['net.whatsapp.WhatsApp'],
  // Fallback derived from AX frames on MacBook Air (window 1450x1010): nav rail | chat list | chat pane.
  // At runtime prefer deriveWhatsAppRegions() (whatsappLayout.ts) on live AX frames.
  regions: {
    sidebar: { x: 0.1586, y: 0.1089, w: 0.2593, h: 0.8911 },
    title: { x: 0.4179, y: 0, w: 0.5821, h: 0.0554 },
    messages: { x: 0.4179, y: 0.0554, w: 0.5821, h: 0.8931 },
    input: { x: 0.4179, y: 0.9485, w: 0.5821, h: 0.0515 },
  },
  // unread badge green (~#25D366)
  unreadBadge: { hsv: [{ hMin: 135, hMax: 150, sMin: 0.6, sMax: 1, vMin: 0.6, vMax: 1 }], minArea: 60, maxArea: 1500 },
  bubbles: { selfSide: 'right', splitFrac: 0.5, minScore: 0.5 },
  pasteKey: 'Cmd+V', sendKey: 'Return', ignorePatterns: [TIME],
};
export const WECHAT: AppConfig = {
  id: 'wechat', displayName: '微信', status: 'implemented', // secondary: no WeChat test account
  bundleIds: ['com.tencent.xinWeChat'],
  regions: SYNTH_GEO,
  // red dot ~#FA5151; red wraps hue 0
  unreadBadge: { hsv: [{ hMin: 0, hMax: 10, sMin: 0.55, sMax: 1, vMin: 0.7, vMax: 1 }, { hMin: 350, hMax: 360, sMin: 0.55, sMax: 1, vMin: 0.7, vMax: 1 }], minArea: 40, maxArea: 1500 },
  bubbles: { selfSide: 'right', splitFrac: 0.5, minScore: 0.5 },
  pasteKey: 'Cmd+V', sendKey: 'Return', ignorePatterns: [TIME],
};
const stub = (id: string, displayName: string, bundleIds: string[]): AppConfig => ({
  ...WECHAT, id, displayName, bundleIds, status: 'stub', // TODO: calibrate on real screenshots
});
export const QQ = stub('qq', 'QQ', ['com.tencent.qq']);
export const WECOM = stub('wecom', '企业微信', ['com.tencent.WeWorkMac']);

export const ALL_CONFIGS = [TELEGRAM, WHATSAPP, WECHAT, QQ, WECOM];
export class TelegramAdapter extends BaseAdapter { constructor() { super(TELEGRAM); } }
export class WhatsAppAdapter extends BaseAdapter { constructor() { super(WHATSAPP); } }
export class WeChatAdapter extends BaseAdapter { constructor() { super(WECHAT); } }
export function adapterFor(bundleId: string): AppAdapter | undefined {
  const c = ALL_CONFIGS.find(c => c.bundleIds.includes(bundleId));
  return c ? new BaseAdapter(c) : undefined;
}

/** Adapter using the synthetic-fixture geometry (tests only; real WhatsApp uses AX-derived regions). */
export function synthAdapterFor(bundleId: string): AppAdapter | undefined {
  const c = ALL_CONFIGS.find(c => c.bundleIds.includes(bundleId));
  return c ? new BaseAdapter({ ...c, regions: SYNTH_GEO }) : undefined;
}
