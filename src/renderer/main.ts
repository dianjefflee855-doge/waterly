const w = (window as any).waterly; const $ = (id: string) => document.getElementById(id)!;
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
const APP: any = { wechat: '微信', whatsapp: 'WhatsApp', telegram: 'Telegram' }; const t = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
let S: any = null; const editing = new Set<string>();
document.querySelectorAll('#nav a').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('#nav a,.page').forEach(e => e.classList.remove('on')); a.classList.add('on'); $('p-' + (a as HTMLElement).dataset.p).classList.add('on'); }));
const feedLi = (f: any) => `<li><div class="m"><span class="tag ${f.source}">${f.source === 'banner' ? '横幅' : '列表'}</span>${APP[f.app]} · ${esc(f.conversation)}${f.read ? '<span class="tag read">已读</span>' : ''}${f.imported ? '<span class="tag imp">导入</span>' : ''}<span>${t(f.at)}</span></div><div>${f.sender ? `<b>${esc(f.sender)}：</b>` : ''}${esc(f.body)}</div>
 <button class="ghost" data-gen="${esc(f.id)}">生成草稿</button></li>`;
const draftEl = (d: any) => `<div class="draft ${d.status}"><div class="m">${APP[d.app]} · <b>${esc(d.conversation)}</b> · ${t(d.createdAt)} · ${({ pending: '待审批', sending: '发送中…', sent: '已发送', copied: '已复制，待你粘贴', failed: '发送失败', discarded: '已丢弃' } as any)[d.status]}</div>
 ${d.context ? `<small>上下文：${esc(d.context)}</small>` : ''}<textarea data-id="${d.id}" ${d.status === 'pending' ? '' : 'disabled'}>${esc(d.text)}</textarea>
 ${d.error ? `<small style="color:var(--bad)">${esc(d.error)}</small><br>` : ''}
 ${d.status === 'pending' || d.status === 'failed' ? `<button data-send="${d.id}">${S?.settings?.sendMode?.[d.app] === 'clipboard' ? '复制到剪贴板' : '发送'}</button> <button class="ghost" data-save="${d.id}">保存修改</button> <button class="danger" data-drop="${d.id}">丢弃</button>` : ''}</div>`;
function render() { if (!S) return;
  ($('auto') as HTMLInputElement).checked = S.autoReply; $('autoHint').textContent = S.autoReply ? '已开启：只生成草稿，发送需确认' : '已关闭';
  $('cards').innerHTML = S.apps.map((a: any) => `<div class="card"><h3><span class="dot ${a.running ? 'g' : 'r'}"></span>${a.name}</h3>
   <div class="kv">运行<b>${a.running ? '运行中' : '未运行'}</b></div><div class="kv">辅助功能权限<b>${({ ok: '已授权', missing: '未授权', unknown: '未知' } as any)[a.permission]}</b></div>
   <div class="kv">上次扫描<b>${t(a.lastScan)}</b></div><div class="kv">未读<b>${a.unread ?? '—'}</b></div>${a.note ? `<small>${esc(a.note)}</small>` : ''}</div>`).join('');
  const pend = S.drafts.filter((d: any) => d.status === 'pending'); $('badge').textContent = pend.length ? String(pend.length) : '';
  $('feedMini').innerHTML = S.feed.slice(0, 6).map(feedLi).join('') || '<div class="empty">暂无新消息</div>';
  $('feed').innerHTML = S.feed.map(feedLi).join('') || '<div class="empty">暂无新消息</div>';
  if (!editing.size) { $('draftMini').innerHTML = pend.slice(0, 3).map(draftEl).join('') || '<div class="empty">没有待审批草稿</div>'; $('drafts').innerHTML = S.drafts.map(draftEl).join('') || '<div class="empty">队列为空</div>'; }
  $('rules').innerHTML = '<tr><th>应用</th><th>会话</th><th>类型</th><th>回复</th><th></th></tr>' + S.rules.map((r: any) => `<tr><td>${APP[r.app]}</td><td>${esc(r.conversation)}</td><td>${r.mode === 'whitelist' ? '白名单' : '黑名单'}</td><td>${r.reply ? '开' : '关'}</td><td><button class="ghost" data-rm="${r.app}|${esc(r.conversation)}">删除</button></td></tr>`).join('');
  const DE = S.lastDraftError; const de = $('draftErr'); if (de) { de.hidden = !DE; if (DE) de.textContent = `AI 草稿生成失败 · ${APP[DE.app] ?? DE.app} · ${DE.conversation} · ${t(DE.at)}：${DE.error}`; }
  if (!S.llm?.hasKey) { if (de) { de.hidden = false; de.textContent = '未配置 API Key，无法生成 AI 草稿（到「模型设置」填你自己的 Key）'; } }
  if (document.activeElement !== $('lockFb')) ($('lockFb') as HTMLInputElement).checked = S.settings?.lockFallback !== false;
  const H = S.history; if (H) { $('hInfo').textContent = `本机已保存 ${H.count} 条消息（其中从通知日志导入 ${H.imported} 条），保留 ${H.days} 天`; if (document.activeElement !== $('hDays')) ($('hDays') as HTMLInputElement).value = String(H.days); }
  if (document.activeElement?.closest('#p-llm') == null) { ($('lModel') as HTMLInputElement).value = S.llm.model; ($('lBase') as HTMLInputElement).value = S.llm.baseUrl; ($('lKey') as HTMLInputElement).placeholder = S.llm.hasKey ? '已配置（留空表示不修改）' : '未配置'; ($('lProv') as HTMLSelectElement).value = S.llm.provider ?? 'minimax'; ($('lCtx') as HTMLInputElement).value = String(S.settings?.contextLimit ?? 20); ($('lSys') as HTMLTextAreaElement).value = S.llm.systemPrompt;
    const pid = S.settings?.persona ?? 'self'; document.querySelectorAll<HTMLInputElement>('input[name=persona]').forEach(r => { r.checked = r.value === pid; });
    const pc = $('lPersonaCustom') as HTMLTextAreaElement; pc.value = S.settings?.personaCustom ?? ''; pc.hidden = pid !== 'custom'; }
  const SM = S.settings?.sendMode ?? {}; $('sendModes').innerHTML = ['wechat', 'whatsapp'].map(a => `<div class="smode"><h2>${APP[a]}</h2>
   <label><input type="radio" name="sm-${a}" data-sm="${a}|clipboard" ${SM[a] !== 'auto' ? 'checked' : ''}> <b>复制到剪贴板</b>（默认，推荐）<br><small>确认后回复复制到剪贴板并弹出通知，你自己切到聊天里粘贴、按发送。Waterly 不操作聊天窗口。</small></label>
   <details ${SM[a] === 'auto' ? 'open' : ''}><summary>高级</summary><label class="risk"><input type="radio" name="sm-${a}" data-sm="${a}|auto" ${SM[a] === 'auto' ? 'checked' : ''}> <b>自动输入发送</b><br>
   <small>⚠ 封号风险：确认后 Waterly 会模拟键盘把回复粘贴进聊天框并按发送。${APP[a]}可能把这类自动化操作识别为外挂/机器人，导致限制功能或封号，后果由你自行承担。${a === 'whatsapp' ? '（WhatsApp 的自动发送目前尚未接入，选了也会提示发送失败。）' : ''}</small></label></details></div>`).join('');
  $('logs').innerHTML = S.logs.map((l: any) => `<div class="${l.level}">${t(l.at)} ${esc(l.msg)}</div>`).join('');
}
document.addEventListener('focusin', e => { const id = (e.target as HTMLElement).dataset?.id; if (id) editing.add(id); });
document.addEventListener('focusout', e => { const id = (e.target as HTMLElement).dataset?.id; if (id) setTimeout(() => editing.delete(id), 300); });
document.addEventListener('click', async e => { const b = e.target as HTMLElement; const d = b.dataset; const val = (id: string) => (document.querySelector(`textarea[data-id="${id}"]`) as HTMLTextAreaElement).value;
  try {
    if (d.sm) { const [app, mode] = d.sm.split('|'); if (mode === 'auto' && S.settings.sendMode[app] !== 'auto') {
        if (!confirm(`开启「自动输入发送」？\n\n封号风险：${APP[app]}可能把自动输入识别为外挂/机器人，导致限制功能或封号。\n每条回复仍需你在待审批里确认。\n\n确定要开启吗？`)) { render(); return; }
        await w.sendMode({ app, mode, confirm: 'I_ACCEPT_BAN_RISK' }); } else await w.sendMode({ app, mode }); }
    if (d.send) { const text = val(d.send); const clip = S.settings?.sendMode?.[S.drafts.find((x: any) => x.id === d.send)?.app] === 'clipboard';
      if (!confirm(clip ? `确认复制到剪贴板？复制后请自己粘贴发送。\n\n${text}` : `确认发送到该会话？\n\n${text}`)) return; await w.edit({ id: d.send, text }).catch(() => {}); editing.clear(); await w.approve({ id: d.send, text }); }
    if (d.save) { await w.edit({ id: d.save, text: val(d.save) }); editing.clear(); }
    if (d.drop) { await w.discard(d.drop); editing.clear(); }
    if (d.gen) { const fi = S.feed.find((x: any) => x.id === d.gen); if (!fi) return; const app = fi.app, conversation = fi.conversation; const b = e.target as HTMLButtonElement; b.disabled = true; b.textContent = '生成中…';
      try { await w.draft({ app, conversation }); b.textContent = '已生成'; } catch (er: any) { b.disabled = false; b.textContent = '生成草稿'; throw new Error('AI 草稿生成失败：' + String(er?.message ?? er).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } }
    if (d.rm) { const [app, conversation] = d.rm.split('|'); await w.rule({ app, conversation, remove: true }); }
  } catch (err: any) { alert(String(err?.message ?? err)); } });
$('lockFb').addEventListener('change', e => w.lockFallback((e.target as HTMLInputElement).checked));
$('hSave').onclick = () => w.historyDays(Number(($('hDays') as HTMLInputElement).value));
$('hClear').onclick = () => { if (confirm('清空本机保存的全部历史消息？待审批草稿会保留。此操作不能撤销。')) w.clearHistory().then((n: number) => alert(`已清空 ${n} 条消息`)); };
$('auto').addEventListener('change', e => w.autoReply((e.target as HTMLInputElement).checked));
$('ndAdd').onclick = () => w.manualDraft({ app: ($('ndApp') as HTMLSelectElement).value, conversation: ($('ndConv') as HTMLInputElement).value, text: ($('ndText') as HTMLInputElement).value });
$('rAdd').onclick = () => w.rule({ app: ($('rApp') as HTMLSelectElement).value, conversation: ($('rConv') as HTMLInputElement).value, mode: ($('rMode') as HTMLSelectElement).value, reply: ($('rReply') as HTMLInputElement).checked });
$('lSave').onclick = () => { const persona = (document.querySelector('input[name=persona]:checked') as HTMLInputElement)?.value || 'self';
  const k = ($('lKey') as HTMLInputElement).value; if (k) { w.setConfig({ apiKey: k }); ($('lKey') as HTMLInputElement).value = ''; }
  w.llm({ provider: ($('lProv') as HTMLSelectElement).value, model: ($('lModel') as HTMLInputElement).value, baseUrl: ($('lBase') as HTMLInputElement).value, systemPrompt: ($('lSys') as HTMLTextAreaElement).value, contextLimit: Number(($('lCtx') as HTMLInputElement).value), persona, personaCustom: ($('lPersonaCustom') as HTMLTextAreaElement).value }); };
document.querySelectorAll('input[name=persona]').forEach(r => r.addEventListener('change', () => { ($('lPersonaCustom') as HTMLTextAreaElement).hidden = (document.querySelector('input[name=persona]:checked') as HTMLInputElement)?.value !== 'custom'; }));
if (w) { w.onState((s: any) => { S = s; render(); }); w.state().then((s: any) => { S = s; render(); }); } else document.body.insertAdjacentHTML('beforeend', '<p>(不在 Electron 中运行)</p>');

// permission onboarding
const PST: any = { granted: '已开启', denied: '未开启', 'not-determined': '未设置', restricted: '受限制', unknown: '未知' };
function renderPerm(p: any) { if (!p || !p.supported) { $('permGuide').hidden = true; $('permBanner').hidden = true; return; }
  for (const id of ['accessibility', 'screen']) { const el = $('perm-' + id); const ok = p[id] === 'granted'; el.classList.toggle('done', ok);
    const st = el.querySelector('.st') as HTMLElement; st.textContent = PST[p[id]] ?? p[id]; st.className = 'st ' + (ok ? 'ok' : 'no'); }
  $('permGuide').hidden = !p.showGuide; $('permBanner').hidden = !(p.limited && !p.showGuide); }
const pcall = (f: string, a?: any) => { try { return Promise.resolve(w?.[f]?.(a)).then((s: any) => { if (s && typeof s === 'object') renderPerm(s); return s; }).catch(() => {}); } catch { return Promise.resolve(); } };
document.addEventListener('click', e => { const d = (e.target as HTMLElement).dataset;
  if (d.popen) pcall('openPermissionPane', d.popen).then(() => pcall('refreshPermissions'));
  if (d.preq) pcall('requestPermission', d.preq); });
$('permLater').onclick = () => pcall('dismissPermissions');
$('permReopen').onclick = () => pcall('showPermissionGuide');
if (w?.onPermissionsChanged) { w.onPermissionsChanged(renderPerm); pcall('getPermissions'); }

// remote access
let RM: any = null;
function renderRemote(s: any) { if (!s) return; RM = s; ($('rmOn') as HTMLInputElement).checked = s.enabled;
  $('rmSt').textContent = !s.enabled ? '已关闭' : s.connected ? '● 在线（已连上中继）' : s.error ? '连接失败：' + s.error : '连接中…';
  ($('rmPair') as HTMLButtonElement).disabled = !s.enabled;
  const p = s.pairing; $('rmPairBox').hidden = !p || p.expiresAt < Date.now();
  if (p) { $('rmCode').textContent = p.code; ($('rmQr') as HTMLImageElement).src = p.qrImg || ''; $('rmExp').textContent = '有效期至 ' + new Date(p.expiresAt).toLocaleTimeString('zh-CN', { hour12: false }) + '，一次性'; }
  $('rmDevs').innerHTML = '<tr><th>设备</th><th>状态</th><th>安全码</th><th>到期</th><th></th></tr>' + (s.devices || []).map((d: any) => `<tr><td>${esc(d.name)}</td><td>${d.online ? '在线' : '离线'}</td><td>${esc(d.sas ?? '')}</td><td>${d.exp ? new Date(d.exp).toLocaleDateString('zh-CN') : '—'}</td><td><button class="danger" data-rv="${esc(d.deviceId)}">吊销</button></td></tr>`).join('') || '<tr><td colspan="5">还没有配对设备</td></tr>'; }
if (w?.onRemote) { w.onRemote(renderRemote); w.remoteStatus().then(renderRemote); setInterval(() => RM && renderRemote(RM), 5000); }
$('rmOn')?.addEventListener('change', e => w.remoteEnable((e.target as HTMLInputElement).checked).then(renderRemote).catch((err: any) => alert(String(err?.message ?? err))));
$('rmPair')?.addEventListener('click', () => w.remotePair().catch((err: any) => alert(String(err?.message ?? err))));
document.addEventListener('click', e => { const id = (e.target as HTMLElement).dataset?.rv; if (id && confirm('吊销这台设备？吊销后它会立刻断开，需要重新配对。')) w.remoteRevoke(id).catch((err: any) => alert(String(err?.message ?? err))); });

// ---- BYO key first-run setup + self-hosted relay settings ----
const PD: any = { minimax: { b: 'https://api.minimaxi.com/v1', m: 'MiniMax-M2' }, openai: { b: 'https://api.openai.com/v1', m: 'gpt-4o-mini' } };
const iv = (id: string) => $(id) as HTMLInputElement;
if (w?.config) w.config().then((c: any) => {
  iv('cRelay').value = c.relayUrl || ''; iv('cWeb').value = c.webUrl || ''; iv('cReg').placeholder = c.hasRegistrationKey ? '已设置（留空表示不修改）' : '未设置（可选）';
  if (c.webUrl) $('rmWebUrl').textContent = ' ' + c.webUrl + ' ';
  if (c.needsSetup) { ($('sProv') as HTMLSelectElement).value = c.provider; iv('sBase').value = c.baseUrl; iv('sModel').value = c.model; $('setup').hidden = false; } });
($('sProv') as HTMLSelectElement).onchange = () => { const d = PD[($('sProv') as HTMLSelectElement).value]; iv('sBase').value = d.b; iv('sModel').value = d.m; };
($('lProv') as HTMLSelectElement).onchange = () => { const d = PD[($('lProv') as HTMLSelectElement).value]; iv('lBase').value = d.b; iv('lModel').value = d.m; };
$('sSave').onclick = async () => { if (!iv('sKey').value.trim()) { $('sMsg').textContent = '请填写 API Key'; return; }
  try { await w.setConfig({ provider: ($('sProv') as HTMLSelectElement).value, baseUrl: iv('sBase').value, model: iv('sModel').value, apiKey: iv('sKey').value, setupDone: true }); iv('sKey').value = ''; $('setup').hidden = true; }
  catch (e: any) { $('sMsg').textContent = String(e?.message ?? e); } };
$('sLater').onclick = () => { $('setup').hidden = true; };
$('cSave').onclick = async () => { try { const c = await w.setConfig({ relayUrl: iv('cRelay').value, webUrl: iv('cWeb').value, registrationKey: iv('cReg').value || undefined }); iv('cReg').value = '';
  $('cMsg').textContent = '已保存'; if (c.webUrl) $('rmWebUrl').textContent = ' ' + c.webUrl + ' '; } catch (e: any) { $('cMsg').textContent = String(e?.message ?? e); } };
