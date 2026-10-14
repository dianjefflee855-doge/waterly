import * as path from 'path'; import * as fs from 'fs'; import * as os from 'os'; import { execFile, execSync } from 'child_process';
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { loadWaterlyEnv } from '../llm/env';
import { MiniMaxClient } from '../llm/minimax';
import { Control, Draft, AppId, APP_NAMES } from '../core/control';
import { parseBanner } from '../platform/mac/notifications';
import { parseSession } from '../adapters/wechat';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { app, BrowserWindow, ipcMain, shell, systemPreferences, desktopCapturer, screen } = require('electron');
import { PermissionMonitor, PermId } from './permissions';
import { NcWatch } from './ncwatch';
import { resPath } from '../platform/mac/resources';
import { spawn } from 'child_process';
loadWaterlyEnv();
const bridge = new MacPlatformBridge(); const j = (a: string[]) => (bridge as any).j(a);
const BUNDLES: Record<AppId, string[]> = { wechat: ['com.tencent.xinWeChat'], whatsapp: ['net.whatsapp.WhatsApp'], telegram: ['ru.keepcoder.Telegram', 'org.telegram.desktop'] };
// Only WeChat send is wired (guarded wxSend tool); others report not wired. Called ONLY from approveDraft.
const sender = (d: Draft) => new Promise<{ ok: boolean; error?: string }>(res => {
  if (d.app !== 'wechat') return res({ ok: false, error: '该应用的发送尚未接入' });
  execFile(process.execPath, [path.join(__dirname, '../tools/wxSend.js')],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', WX_CONFIRM: 'SEND_ONCE', WX_CHAT: d.conversation, WX_TEXT: d.text }, timeout: 120000 }, (e, out) => {
      try { const r = JSON.parse(out); const ok = r.steps.some((s: any) => s.appeared === true); res({ ok, error: ok ? undefined : JSON.stringify(r.steps.filter((s: any) => s.ABORT || s.fatal || s.open)) }); }
      catch { res({ ok: false, error: String(e?.message ?? out) }); } });
});
// clipboard mode (default for WeChat/WhatsApp): copy approved text + notify; the user pastes and sends by hand.
const { clipboard, Notification } = require('electron');
// verify by NSPasteboard changeCount via axhelper (no read-back: macOS 26+ paste privacy can make readText() return '' →
// the old check failed with 剪贴板写入校验失败 on 2026-10-13 22:18). Fallback: Electron write, trusted without read-back.
const copier = async (d: Draft) => { let r: any = null;
  try { r = j(['clipset', d.text]); } catch { r = null; }
  if (r && r.ok === false) return { ok: false, error: `剪贴板写入失败（set=${r.set}, changeCount ${r.before}→${r.after}）` };
  if (!r || r.ok !== true) clipboard.writeText(d.text);
  try { if (Notification.isSupported()) new Notification({ title: `已复制回复 · ${d.conversation}`, body: `请切到${APP_NAMES[d.app] ?? d.app}的「${d.conversation}」对话，Cmd+V 粘贴后自己按发送` }).show(); } catch {}
  return { ok: true }; };
const SETTINGS = path.join(os.homedir(), '.config/waterly/settings.json');
const store = { load: () => { try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch { return null; } },
  save: (s: any) => { fs.mkdirSync(path.dirname(SETTINGS), { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 1)); } };
import { HistoryStore } from '../core/history';
import { ingestNcLog } from './ncimport';
// local history (feed + drafts) survives restarts: ~/.config/waterly/history.jsonl, 0600, debounced writes
const HISTORY = path.join(os.homedir(), '.config/waterly/history.jsonl');
let histT: any = null; const sched = (f: () => void) => { clearTimeout(histT); histT = setTimeout(f, 1000); };
const ctl = new Control(sender, undefined, copier, store, new HistoryStore(HISTORY, fs as any, path.dirname), sched);
ctl.isLocked = () => { try { const r: any = j(['screenlocked']); return r.locked === true || r.onConsole === false; } catch { return false; } };
// remote event log (no message text): ~/Library/Logs/Waterly/remote.log, JSON lines, 0600, rotated at 1 MB
const RLOG = path.join(os.homedir(), 'Library/Logs/Waterly/remote.log');
const remoteEvent = (ev: any) => { try { fs.mkdirSync(path.dirname(RLOG), { recursive: true });
  try { if (fs.statSync(RLOG).size > 1 << 20) fs.renameSync(RLOG, RLOG + '.1'); } catch {}
  fs.appendFileSync(RLOG, JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n', { mode: 0o600 }); } catch {} };
const uiState = () => ({ ...ctl.s, feed: ctl.s.feed.slice(0, 500), history: { count: ctl.s.feed.length, imported: ctl.hmeta.importedCount ?? 0, days: ctl.s.settings.historyDays, file: HISTORY } });
import { ConfigStore, publicConfig } from './localConfig';
// BYO key: the user's own key from first-run setup (~/.config/waterly/config.json, 0600). No key is ever built into the app.
// Dev override: env WATERLY_API_KEY / MINIMAX_API_KEY. Key stays in main; renderer only sees hasKey.
const cfg = new ConfigStore(path.join(os.homedir(), '.config/waterly/config.json'));
const apiKey = () => cfg.c.apiKey || process.env.WATERLY_API_KEY || process.env.MINIMAX_API_KEY || undefined;
const syncLlm = () => Object.assign(ctl.s.llm, { provider: cfg.c.provider, baseUrl: cfg.c.baseUrl, model: cfg.c.model, hasKey: !!apiKey() });
syncLlm();
const llmOpts = () => ({ apiKey: apiKey(), baseUrl: cfg.c.baseUrl, model: cfg.c.model, systemPrompt: ctl.personaPrompt(ctl.s.llm.systemPrompt), contextLimit: ctl.s.settings.contextLimit });
import { Drafter } from './drafts';
const drafter = new Drafter({ ctl, hasKey: () => !!apiKey(), client: o => new MiniMaxClient({ ...llmOpts(), ...o }) });
// auto-reply (master switch ON only): new unread incoming message → one AI draft per conversation (never sends).
const autoSeen = new Set<string>(); const START = new Date().toISOString();
function autoDrafts() { if (!ctl.s.autoReply) { ctl.s.feed.forEach(f => autoSeen.add(f.id)); return; }
  for (const f of ctl.s.feed) { if (autoSeen.has(f.id)) continue; autoSeen.add(f.id); if (f.read || f.imported || f.at < START) continue;
    if (ctl.s.drafts.some(d => d.app === f.app && d.conversation === f.conversation && d.status === 'pending')) continue;
    drafter.generate({ app: f.app, conversation: f.conversation, source: '（自动回复草稿）' }).then(() => push()).catch(() => {}); } }
let win: any; let perm: PermissionMonitor | null = null; const permOk = () => !perm || perm.state.allGranted || perm.state.accessibility === 'granted';
const pushUi = () => win?.webContents.send('waterly:state', uiState());
// ---- remote access (default OFF; state in ~/.config/waterly/remote.json, 0600) ----
import { RemoteAccess } from './remote/remote';
// relay + web page are self-hosted by each user (see relay/README.md); nothing is hardcoded.
const relayUrl = () => cfg.c.relayUrl || process.env.WATERLY_RELAY || '';
const webUrl = () => (cfg.c.webUrl || process.env.WATERLY_WEB || '').replace(/\/?$/, '/');
const regKey = () => cfg.c.registrationKey || process.env.WATERLY_REGISTRATION_KEY || undefined;
const remote = new RemoteAccess({ relay: relayUrl(), web: webUrl(),
  statePath: path.join(os.homedir(), '.config/waterly/remote.json'), regKey: regKey(),
  getState: () => ctl.s, log: (l, m) => { ctl.log(l, m); pushUi(); }, onChange: s => { try { win?.webContents.send('waterly:remote', s); } catch {} },
  draft: async (app, conversation, o) => { const r = await drafter.generate({ app: app as AppId, conversation, persona: o.persona, personaCustom: o.personaCustom, contextLimit: o.contextLimit, source: '（来自手机远程）' }); push(); return r; },
  event: remoteEvent,
  qr: t => require('qrcode').toDataURL(t, { margin: 1, width: 240 }),
  // phone already confirmed; goes through the normal approval path so 发送方式 (clipboard default / auto only if enabled) and 会话规则 apply.
  send: async (app, conversation, text) => { if (!ctl.allowed(app as AppId, conversation)) return { ok: false, code: 'rule_blocked', error: '该会话被「会话规则」禁止回复' };
    const d = ctl.addDraft(app as AppId, conversation, text, '（来自手机远程）'); const r = await ctl.approveDraft(d.id, text); pushUi(); const extra = { sent: r.status === 'sent', copied: r.status === 'copied', fallback: r.fallback };
    const ok = r.status === 'sent' || r.status === 'copied'; return { ok, ...extra, code: ok ? undefined : /尚未接入/.test(r.error ?? '') ? 'not_supported' : 'send_failed', error: r.error, via: r.via }; } });
const push = () => { autoDrafts(); pushUi(); remote.onStateChanged().catch(() => {}); };
// status: running + AX permission
async function refreshStatus() {
  let perms: any = {}; try { perms = await bridge.checkPermissions(); } catch {}
  let wins: any[] = []; try { wins = await bridge.enumerateWindows(); } catch {}
  for (const a of ctl.s.apps) { a.running = wins.some(w => BUNDLES[a.id].includes(w.bundleId)); a.permission = perms.accessibility === true ? 'ok' : perms.accessibility === false ? 'missing' : 'unknown'; }
}
// WeChat chat-list scan (AX read only: no clicks, does not mark read)
let lastFp = new Map<string, string>();
function scanWeChat() {
  const a = ctl.s.apps.find(x => x.id === 'wechat')!; if (!a.running) return; if (!permOk()) { a.note = '权限未开启，功能受限'; return; }
  try { const rows = (j(['subtree', 'com.tencent.xinWeChat', 'session_list', '1']) as any[]).filter(e => e.depth === 1 && (e.identifier ?? '').startsWith('session_item_')).map(e => parseSession(e.identifier, e.title ?? '', e.frame.y));
    a.lastScan = new Date().toISOString(); a.unread = rows.reduce((n, r) => n + (r.unread > 0 ? r.unread : 0), 0);
    for (const r of rows) { const fp = `${r.unread}|${r.time}|${r.preview}`; const prev = lastFp.get(r.name); lastFp.set(r.name, fp); if (prev === fp) continue;
      if (r.unread > 0) { ctl.addFeed({ app: 'wechat', conversation: r.name, sender: r.lastSender, body: `[${r.unread}条未读] ${r.preview}`, at: a.lastScan, source: 'scan' }); continue; }
      // read chat: keep its history (mark read, don't drop); record the latest preview once if we don't have it yet
      ctl.markConvRead('wechat', r.name);
      const pv = String(r.preview ?? '').trim(); if (!pv) continue;
      const last = ctl.s.feed.find(f => f.app === 'wechat' && f.conversation === r.name);
      if (!last || (last.body !== pv && !last.body.endsWith(pv))) ctl.addFeed({ app: 'wechat', conversation: r.name, sender: r.lastSender, body: pv, at: a.lastScan, source: 'scan', read: true }); }
  } catch (e: any) { a.note = '列表读取失败'; }
}
// banner trigger: tail ncwatch log
const NCLOG = path.join(os.homedir(), 'waterly_tmp/ncwatch.log');
// tail from the offset persisted in history meta (first run imports the whole existing log once, marked read)
function tailBanners() { const first = !ctl.hmeta.ncImported;
  const r = ingestNcLog(ctl, { size: () => fs.statSync(NCLOG).size, read: (a, b) => { const fd = fs.openSync(NCLOG, 'r'); try { const buf = Buffer.alloc(b - a); fs.readSync(fd, buf, 0, buf.length, a); return buf.toString('utf8'); } finally { fs.closeSync(fd); } } },
    t => { if (!first) ctl.log(t ? 'info' : 'warn', `通知监听器启动，辅助功能授权=${t}`); });
  if (first && ctl.hmeta.ncImported) ctl.log('info', `已从通知日志导入历史消息 ${r.added} 条`);
  else if (r.added) setTimeout(() => { scanWeChat(); push(); }, 2500); }
// live trigger: spawn bundled ncwatch (read-only banner watcher); feed + debounced per-app scan. Never sends.
const NCBIN = resPath('native/mac/build/ncwatch');
const nc = new NcWatch({ bin: NCBIN, spawn: (b, a) => spawn(b, a, { stdio: ['ignore', 'pipe', 'pipe'] }), onLog: (l, m) => { ctl.log(l, m); push(); },
  onBanner: (id, n) => { ctl.addFeed({ app: id, conversation: n.conversation, sender: n.sender, body: n.body, at: n.receivedAt, source: 'banner' }); push(); },
  onTrigger: async id => { try { await refreshStatus(); if (id === 'wechat') scanWeChat(); } catch {} push(); } });
function startNc() { if (process.platform !== 'darwin' || nc.running || !permOk()) return; if (!fs.existsSync(NCBIN)) { ctl.log('warn', '未找到 ncwatch，改用轮询'); return; } nc.start(); }
async function tick() { startNc(); if (perm?.state.limited && !permOk()) { try { tailBanners(); push(); } catch {} return; }
   await refreshStatus(); tailBanners(); scanWeChat(); push(); }
ipcMain.handle('waterly:state', () => uiState());
ipcMain.handle('waterly:lockFallback', (_: any, on: boolean) => { ctl.setLockFallback(!!on); push(); return ctl.s.settings; });
ipcMain.handle('waterly:historyDays', (_: any, n: number) => { const v = ctl.setHistoryDays(n); push(); return v; });
ipcMain.handle('waterly:clearHistory', () => { const n = ctl.clearHistory(); push(); remote.resync().catch(() => {}); return n; });
ipcMain.handle('waterly:remoteStatus', () => remote.status);
ipcMain.handle('waterly:remoteEnable', (_: any, on: boolean) => remote.setEnabled(!!on));
ipcMain.handle('waterly:remotePair', () => remote.startPairing());
ipcMain.handle('waterly:remoteRevoke', (_: any, id: string) => { remote.revoke(String(id)); return true; });
const PIDS = ['accessibility', 'screen'];
ipcMain.handle('waterly:getPermissions', () => perm?.state ?? null);
ipcMain.handle('waterly:refreshPermissions', () => perm?.refresh() ?? null);
ipcMain.handle('waterly:openPermissionPane', (_: any, id: PermId) => PIDS.includes(id) ? perm?.open(id) ?? false : false);
ipcMain.handle('waterly:requestPermission', (_: any, id: PermId) => PIDS.includes(id) ? perm?.request(id) ?? null : perm?.state ?? null);
ipcMain.handle('waterly:dismissPermissions', () => perm?.dismiss() ?? null);
ipcMain.handle('waterly:showPermissionGuide', () => perm?.showGuide() ?? null);
ipcMain.handle('waterly:autoReply', (_: any, on: boolean) => { ctl.setAutoReply(!!on); push(); });
ipcMain.handle('waterly:draft', async (_: any, a: { app: AppId; conversation: string; context: string }) => {
  if (!ctl.allowed(a.app, a.conversation)) throw new Error('该会话被规则禁止回复');
  // uses the conversation's own history (last 上下文条数 messages) + 回复身份; failures are logged and shown, not swallowed
  const r = await drafter.generate({ app: a.app, conversation: a.conversation }); push(); if (!r.ok) throw new Error(r.error); return r.draft; });
ipcMain.handle('waterly:manualDraft', (_: any, a: { app: AppId; conversation: string; text: string }) => { const d = ctl.addDraft(a.app, a.conversation, a.text); push(); return d; });
ipcMain.handle('waterly:edit', (_: any, a: { id: string; text: string }) => { ctl.editDraft(a.id, a.text); push(); });
ipcMain.handle('waterly:discard', (_: any, id: string) => { ctl.discardDraft(id); push(); });
ipcMain.handle('waterly:approve', async (_: any, a: { id: string; text: string }) => { const r = await ctl.approveDraft(a.id, a.text); push(); return r; });
ipcMain.handle('waterly:sendMode', (_: any, a: { app: any; mode: any; confirm?: string }) => { ctl.setSendMode(a.app, a.mode, a.confirm); push(); return ctl.s.settings; });
ipcMain.handle('waterly:rule', (_: any, r: any) => { r.remove ? ctl.removeRule(r.app, r.conversation) : ctl.setRule(r); push(); });
ipcMain.handle('waterly:config', () => publicConfig(cfg.c));
ipcMain.handle('waterly:setConfig', async (_: any, p: any) => { const before = { r: relayUrl(), k: regKey() }; cfg.update(p ?? {}); syncLlm();
  if (before.r !== relayUrl() || before.k !== regKey()) await remote.configure({ relay: relayUrl(), web: webUrl(), regKey: regKey() }); else remote.configure({ web: webUrl() }, false);
  push(); return publicConfig(cfg.c); });
ipcMain.handle('waterly:llm', (_: any, s: any) => { if (s.model != null || s.baseUrl != null || s.provider != null) { cfg.update({ provider: s.provider, model: s.model, baseUrl: s.baseUrl }); syncLlm(); } Object.assign(ctl.s.llm, { systemPrompt: s.systemPrompt }); if (s.contextLimit != null) ctl.setContextLimit(s.contextLimit); if (s.persona != null) ctl.setPersona(s.persona, s.personaCustom); push(); });
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1280, height: 820, title: 'Waterly 控制台', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  // background residency: on macOS closing the main window only hides it (ncwatch keeps running); Dock click / Cmd+Q as usual.
  win.on('close', (e: any) => { if (process.platform === 'darwin' && !quitting) { e.preventDefault(); win?.hide(); } }); ctl.log('info', 'Waterly 已启动，自动回复默认关闭');
  let started = false; const startWork = () => { if (started) return; started = true; ctl.log('info', '权限已就绪，开始扫描'); tick(); };
  try {
    perm = new PermissionMonitor({ platform: process.platform, systemPreferences, openExternal: (u: string) => shell.openExternal(u),
      getScreenSources: () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }) },
      s => { try { win?.webContents.send('waterly:permissions', s); } catch {} if (!s.allGranted) ctl.log('warn', `权限未齐：辅助功能=${s.accessibility} 屏幕录制=${s.screen}`); push(); }, startWork);
    if (!perm.state.allGranted) ctl.log('warn', `权限未齐：辅助功能=${perm.state.accessibility} 屏幕录制=${perm.state.screen}`);
    perm.start();
  } catch (e: any) { perm = null; ctl.log('warn', '权限检测失败：' + String(e?.message ?? e)); startWork(); }
  tailBanners(); remote.start(); setInterval(() => { if (ctl.pruneHistory()) push(); }, 3600000); setInterval(tick, 30000); setInterval(() => { if (!nc.running) { tailBanners(); push(); } }, 2000);
});
let quitting = false;
app.on('before-quit', () => { quitting = true; clearTimeout(histT); ctl.flush(); nc.stop(); remote.stop(); });
app.on('activate', () => { try { if (win && !win.isDestroyed()) { win.show(); win.focus(); } } catch {} });
// only non-mac quits on last window; on mac the app stays resident.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') { nc.stop(); app.quit(); } });
