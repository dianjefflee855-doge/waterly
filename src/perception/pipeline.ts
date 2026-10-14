import { AppAdapter } from '../adapters/AppAdapter';
import { ChatMessage, Frame } from '../core/types';
import { detectBadges, Blob } from './redDot';
import { OcrEngine } from './ocr';

export class Perception {
  constructor(private ocr: OcrEngine) {}
  unread(a: AppAdapter, f: Frame): Blob[] {
    const c = a.config; const r = a.toPx(c.regions.sidebar, f.width, f.height);
    return detectBadges(f, r, c.unreadBadge.hsv, c.unreadBadge.minArea, c.unreadBadge.maxArea);
  }
  async title(a: AppAdapter, f: Frame): Promise<string> {
    if (!f.source) throw new Error('frame has no file source (real Mac: write PNG to tmp first)');
    const lines = await this.ocr.recognize(f.source, a.toPx(a.config.regions.title, f.width, f.height));
    return lines.map(l => l.text).join(' ').trim();
  }
  async messages(a: AppAdapter, f: Frame): Promise<ChatMessage[]> {
    if (!f.source) throw new Error('frame has no file source');
    const lines = await this.ocr.recognize(f.source, a.toPx(a.config.regions.messages, f.width, f.height));
    return a.parseMessages(lines, f.width, f.height);
  }
}
