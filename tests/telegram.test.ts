import { describe, it, expect } from 'vitest';
import { deriveTelegramRegions, readHeader, parseList, parseMessages, nameEq } from '../src/adapters/telegram';
const L = (x0: number, y0: number, x1: number, y1: number, text: string, score = 0.9) => ({ box: [x0, y0, x1, y1] as [number, number, number, number], text, score });
const k = 2, win = { w: 1313, h: 945 };
const base = [L(300, 120, 400, 150, '搜索 (⌘K)')]; // centre x 350px -> 175pt -> listW 350pt
describe('telegram', () => {
  const reg = deriveTelegramRegions(base, k, win);
  it('regions from search field; single pane without it', () => {
    expect(reg.listW).toBe(350); expect(reg.singlePane).toBe(false);
    expect(deriveTelegramRegions([], k, win).singlePane).toBe(true);
  });
  it('header name / group subtitle', () => {
    const h = readHeader([L(760, 20, 1000, 50, 'LD 游戏技术群'), L(760, 56, 880, 80, '11 位成员')], reg, k);
    expect(h).toMatchObject({ name: 'LD 游戏技术群', group: true });
    expect(readHeader([L(760, 20, 900, 50, 'kun kun'), L(760, 56, 900, 80, '最后上线于 14:00')], reg, k).group).toBe(false);
    expect(nameEq('LD游戏技术群', 'LD 游戏技术群')).toBe(true);
    // translucent header: message text showing through above the name must be ignored
    expect(readHeader([L(800, 2, 1000, 18, 'dev有修复么', 0.95), L(760, 20, 1000, 50, 'LD游戏技术群', 0.85), L(760, 56, 880, 80, '11 位成员')], reg, k).name).toBe('LD游戏技术群');
  });
  it('list rows with unread badge', () => {
    const rows = parseList([L(150, 300, 300, 330, 'calling'), L(600, 300, 680, 325, '13:15'), L(150, 340, 500, 370, 'preview'),
      L(150, 438, 220, 468, 'yt'), L(600, 438, 680, 462, '14:21'), L(150, 478, 500, 505, 'msg'), L(640, 480, 670, 505, '2')], reg, k);
    expect(rows.map(r => [r.name, r.time, r.unread])).toEqual([['calling', '13:15', 0], ['yt', '14:21', 2]]);
  });
  it('messages: sender lines, self side, time split, mentions', () => {
    const coloured = new Set(['allen page']);
    const ms = parseMessages([L(760, 200, 900, 225, 'allen page'), L(760, 228, 1300, 255, '是具体问题吗 13:35'),
      L(760, 300, 1100, 330, '@kunkun666365 13:37'), L(2000, 400, 2400, 430, '好的 14:00')], reg, k, true, l => coloured.has(l.text));
    expect(ms.map(m => [m.self, m.sender, m.text, m.time])).toEqual([[false, 'allen page', '是具体问题吗', '13:35'], [false, 'allen page', '@kunkun666365', '13:37'], [true, 'self', '好的', '14:00']]);
    expect(ms[1].mentions).toEqual(['kunkun666365']);
  });
});
