// Read ncwatch.log (Waterly's own banner log, JSON lines) from the persisted offset into the feed. No WeChat DB/files.
import { parseLine } from './ncwatch';
import type { Control } from '../core/control';
export interface ReadFile { size(): number; read(from: number, to: number): string }
/** Returns {added, offset}. First run (meta.ncImported falsy): reads from 0 and marks items imported+read. Only complete lines are consumed. */
export function ingestNcLog(ctl: Control, f: ReadFile, onStart?: (trusted: boolean) => void) {
  const m = ctl.hmeta; let size: number; try { size = f.size(); } catch { return { added: 0, offset: m.ncOffset ?? 0 }; }
  const first = !m.ncImported; let from = first ? 0 : (m.ncOffset ?? 0); if (size < from) from = 0; // truncated/rotated
  if (size === from) { if (first) { m.ncImported = true; m.importedCount = m.importedCount ?? 0; m.ncOffset = size; ctl.flush(); } return { added: 0, offset: size }; }
  const txt = f.read(from, size); const lastNl = txt.lastIndexOf('\n'); if (lastNl < 0 && !first) return { added: 0, offset: from };
  const body = lastNl < 0 ? '' : txt.slice(0, lastNl + 1); const consumed = Buffer.byteLength(body, 'utf8');
  let added = 0;
  for (const l of body.split('\n')) { const ev = parseLine(l); if (!ev) continue;
    if (ev.kind === 'start') { onStart?.(ev.trusted); continue; } if (ev.kind !== 'banner') continue;
    const it = ctl.addFeed({ app: ev.app, conversation: ev.n.conversation, sender: ev.n.sender, body: ev.n.body, at: ev.n.receivedAt, source: 'banner', ...(first ? { read: true, imported: true } : {}) });
    if (it) added++; }
  m.ncOffset = from + consumed; if (first) { m.ncImported = true; m.importedCount = (m.importedCount ?? 0) + added; }
  ctl.flush(); return { added, offset: m.ncOffset };
}
