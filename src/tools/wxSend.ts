// ONE approved send in WeChat. Aborts before Enter on any mismatch. Env: WX_CHAT, WX_TEXT, WX_CONFIRM=SEND_ONCE
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { parseSession, wxNameEq, WX_BUNDLES } from '../adapters/wechat';
import { execSync } from 'child_process';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms)); const keep = setInterval(() => {}, 1000);
const T = process.env.WX_CHAT!, TEXT = process.env.WX_TEXT!; const R: any = { steps: [] }; const st = (k: string, v: any) => R.steps.push({ [k]: v });
(async () => {
  if (process.env.WX_CONFIRM !== 'SEND_ONCE' || !T || !TEXT) throw new Error('not confirmed');
  const b = new MacPlatformBridge(); const j = (a: string[]) => (b as any).j(a); const B = WX_BUNDLES[0];
  const pid = execSync('pgrep -x WeChat').toString().trim().split('\n')[0];
  const sub = (id: string, d: number): any[] => { try { return j(['subtree', B, id, String(d)]); } catch { return []; } };
  const any = (await b.enumerateWindows([B])).filter(w => w.bounds.h > 80).sort((a, c) => c.bounds.w * c.bounds.h - a.bounds.w * a.bounds.h)[0];
  await b.raise(any.windowId); await sleep(1000);
  const hdr = () => sub('current_chat_name_label', 0)[0]?.value ?? '';
  const sessions = () => sub('session_list', 1).filter(e => e.depth === 1 && (e.identifier ?? '').startsWith('session_item_')).map(e => ({ ...parseSession(e.identifier, e.title ?? '', e.frame.y), frame: e.frame }));
  const lf = () => sub('session_list', 0)[0].frame;
  const ls = (d: number) => { const f = lf(); j(['hidwheelat', String(f.x + f.w / 2), String(f.y + Math.min(f.h / 2, 300)), String(d * Math.round(f.h * 0.7))]); };
  const toTop = () => { for (let i = 0; i < 40; i++) { const a = sessions().map(x => x.name).join('|'); ls(-1); ls(-1); if (sessions().map(x => x.name).join('|') === a) break; } };
  const open = async (name: string) => { toTop(); for (let i = 0; i < 10; i++) { const x = sessions().find(y => wxNameEq(y.name, name)); const f = lf();
    if (x && x.frame.y >= f.y && x.frame.y + x.frame.h <= f.y + f.h) { j(['hidclickat', String(x.frame.x + x.frame.w / 2), String(x.frame.y + x.frame.h / 2)]); await sleep(900); return hdr() === name; } ls(1); } return false; };
  const comp = () => { const c = sub('chat_input_field', 0)[0]; return c ? (c.numChars ?? (c.value ?? '').length) : -1; };
  const focused = () => j(['focusedelem', pid])?.identifier === 'chat_input_field';
  const lastMsg = () => { const m = sub('chat_message_list', 1).filter(e => e.depth === 1 && e.identifier === 'chat_bubble_item_view'); return (m[m.length - 1]?.title ?? '').trim(); };
  const orig = hdr(); R.orig = orig;
  if (!(await open(T))) { st('open', 'FAIL header=' + hdr()); return; } st('header', hdr());
  const c0 = comp(); st('composerBefore', c0); if (c0 !== 0) { st('ABORT', 'composer not empty/unreadable'); return; }
  const before = lastMsg();
  let clipSaved = true; try { j(['clipsave', '/tmp/wx_clip.json']); } catch { clipSaved = false; st('clipsave', 'skipped (paste privacy)'); }
  try {
    j(['axfocus', B, 'chat_input_field']); await sleep(300); if (!focused()) { st('ABORT', 'focus'); return; }
    j(['clipset', TEXT]); j(['key', pid, 'Cmd+V']); await sleep(500);
    const n = comp(); st('pasted', n); const v = sub('chat_input_field', 0)[0]?.value;
    if (n !== [...TEXT].length && n !== TEXT.length) { st('ABORT', 'count mismatch, clearing'); j(['key', pid, 'Cmd+A']); j(['key', pid, 'Delete']); st('cleared', comp()); return; }
    if (v !== undefined && v !== TEXT) { st('ABORT', 'text mismatch, clearing'); j(['key', pid, 'Cmd+A']); j(['key', pid, 'Delete']); st('cleared', comp()); return; }
    if (hdr() !== T || !focused()) { st('ABORT', 'header/focus changed, clearing'); if (focused()) { j(['key', pid, 'Cmd+A']); j(['key', pid, 'Delete']); } return; }
    j(['key', pid, 'Return', '--allow-send']); st('enter', 'pressed once'); await sleep(1500);
    st('composerAfter', comp()); const last = lastMsg(); st('lastMsg', last); st('appeared', last === TEXT && last !== before);
  } finally { if (clipSaved) { try { j(['cliprestore', '/tmp/wx_clip.json']); st('clipRestored', true); } catch { st('clipRestored', false); } } execSync('rm -f /tmp/wx_clip.json');
    if (orig && orig !== T) st('restoredOrig', await open(orig)); toTop(); }
})().catch(e => st('fatal', String(e?.message ?? e))).finally(() => { console.log(JSON.stringify(R, null, 1)); clearInterval(keep); });
