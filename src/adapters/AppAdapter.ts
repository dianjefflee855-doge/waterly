import { ChatMessage, Rect } from '../core/types';

/** Fractional region (0..1) of the window, so it survives resizing/Retina scaling. */
export interface FracRect { x: number; y: number; w: number; h: number }
export interface HsvRange { hMin: number; hMax: number; sMin: number; sMax: number; vMin: number; vMax: number }
export interface AppConfig {
  id: 'wechat' | 'telegram' | 'whatsapp' | 'qq' | 'wecom' | string;
  displayName: string;
  bundleIds: string[];
  status: 'implemented' | 'stub';
  regions: { sidebar: FracRect; title: FracRect; messages: FracRect; input: FracRect };
  /** unread badge / red dot colour; components outside [minArea,maxArea] px are ignored */
  unreadBadge: { hsv: HsvRange[]; minArea: number; maxArea: number };
  bubbles: { selfSide: 'right' | 'left'; splitFrac: number /* within messages region */; minScore: number };
  pasteKey: string;   // Cmd+V
  sendKey: string;    // Return / Cmd+Return
  /** text lines to ignore (timestamps, system tips) */
  ignorePatterns: RegExp[];
}

export interface AppAdapter {
  config: AppConfig;
  matches(bundleId: string): boolean;
  toPx(r: FracRect, winW: number, winH: number): Rect;
  /** turn OCR lines (window coords) into ordered chat messages */
  parseMessages(lines: { box: [number, number, number, number]; text: string; score: number }[], winW: number, winH: number): ChatMessage[];
}

export class BaseAdapter implements AppAdapter {
  constructor(public config: AppConfig) {}
  matches(b: string) { return this.config.bundleIds.includes(b); }
  toPx(r: FracRect, W: number, H: number): Rect {
    return { x: Math.round(r.x * W), y: Math.round(r.y * H), w: Math.round(r.w * W), h: Math.round(r.h * H) };
  }
  parseMessages(lines: { box: [number, number, number, number]; text: string; score: number }[], W: number, H: number): ChatMessage[] {
    const m = this.toPx(this.config.regions.messages, W, H);
    const split = m.x + m.w * this.config.bubbles.splitFrac;
    return lines
      .filter(l => l.score >= this.config.bubbles.minScore)
      .filter(l => l.box[1] >= m.y && l.box[3] <= m.y + m.h && l.box[0] >= m.x)
      .filter(l => !this.config.ignorePatterns.some(p => p.test(l.text.trim())))
      .sort((a, b) => a.box[1] - b.box[1])
      .map(l => {
        const cx = (l.box[0] + l.box[2]) / 2;
        const onRight = cx > split;
        const self = this.config.bubbles.selfSide === 'right' ? onRight : !onRight;
        return { speaker: self ? 'self' : 'other', text: l.text.trim(), box: l.box } as ChatMessage;
      });
  }
}
