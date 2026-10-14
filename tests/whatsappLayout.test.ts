import { describe, it, expect } from 'vitest';
import { deriveWhatsAppRegions } from '../src/adapters/whatsappLayout';
const F = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
// frames observed on MacBook Air (WhatsApp Mac, 1450x1010 window)
const els = [
  { role: 'window', frame: F(215, 38, 1450, 1010) },
  { role: 'AXStaticText', identifier: 'SidebarButton_Chats', frame: F(225, 89, 210, 26) },
  { role: 'AXGroup', identifier: 'ChatListView_TableView', frame: F(215, 38, 605, 1010) },
  { role: 'AXGroup', identifier: 'ChatMessagesTableView', frame: F(821, 38, 844, 1010) },
  { role: 'AXGroup', identifier: 'WDSNavigationBar', frame: F(215, 48, 605, 100) },
  { role: 'AXGroup', identifier: 'WDSNavigationBar', frame: F(821, 48, 844, 46) },
  { role: 'AXButton', identifier: 'NavigationBar_HeaderViewButton', frame: F(874, 48, 82, 36) },
  { role: 'AXButton', identifier: 'ChatBar_AttachMediaButton', frame: F(831, 1004, 36, 36) },
  { role: 'AXTextArea', identifier: 'ChatBar_ComposerTextView', frame: F(886, 1012, 718, 21) },
];
describe('deriveWhatsAppRegions', () => {
  it('derives non-overlapping regions from AX frames', () => {
    const r = deriveWhatsAppRegions(els)!;
    expect(r.sidebar.x).toBeCloseTo((445 - 215) / 1450, 3);
    expect(r.title.x).toBeCloseTo((821 - 215) / 1450, 3);
    expect(r.title.y + r.title.h).toBeCloseTo(r.messages.y, 4);
    expect(r.messages.y + r.messages.h).toBeCloseTo(r.input.y, 4);
    expect(r.sidebar.x + r.sidebar.w).toBeCloseTo(r.title.x, 4);
  });
  it('returns null without anchors', () => { expect(deriveWhatsAppRegions(els.slice(0, 3))).toBeNull(); });
});
describe('single pane', () => {
  it('flags single-pane when chat list is absent', () => {
    const r = deriveWhatsAppRegions([
      { role: 'window', frame: F(0, 0, 600, 700) },
      { role: 'AXGroup', identifier: 'ChatMessagesTableView', frame: F(0, 0, 600, 700) },
      { role: 'AXButton', identifier: 'NavigationBar_HeaderViewButton', frame: F(50, 10, 80, 36) },
      { role: 'AXTextArea', identifier: 'ChatBar_ComposerTextView', frame: F(60, 660, 480, 21) },
    ])!;
    expect(r.singlePane).toBe(true); expect(r.sidebar.w).toBe(0); expect(r.title.x).toBe(0);
  });
});
