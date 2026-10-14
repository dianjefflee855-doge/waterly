import { describe, it, expect, vi } from 'vitest';
import { readPermissions, PermissionMonitor, PANE_URL } from '../src/main/permissions';
const mk = (ax: boolean, scr: string, platform = 'darwin') => { const sp = { ax, scr, isTrustedAccessibilityClient: vi.fn(function (this: any) { return sp.ax; }), getMediaAccessStatus: vi.fn(() => sp.scr) };
  return { sp, deps: { platform, systemPreferences: sp, openExternal: vi.fn(async () => {}), getScreenSources: vi.fn(async () => []) } }; };
describe('permissions', () => {
  it('non-mac skips', () => { const s = readPermissions(mk(false, 'denied', 'win32').deps); expect(s.supported).toBe(false); expect(s.showGuide).toBe(false); expect(s.limited).toBe(false); });
  it('detects missing and granted', () => {
    expect(readPermissions(mk(false, 'granted').deps)).toMatchObject({ accessibility: 'denied', screen: 'granted', showGuide: true, limited: true });
    expect(readPermissions(mk(true, 'granted').deps)).toMatchObject({ allGranted: true, showGuide: false, limited: false });
    expect(readPermissions(mk(true, 'weird').deps).screen).toBe('unknown');
  });
  it('never throws when systemPreferences throws', () => { const d: any = mk(true, 'granted').deps; d.systemPreferences = { isTrustedAccessibilityClient: () => { throw new Error('x'); }, getMediaAccessStatus: () => { throw new Error('y'); } };
    expect(readPermissions(d)).toMatchObject({ accessibility: 'unknown', screen: 'unknown', limited: true }); });
  it('checks without prompting', () => { const m = mk(true, 'granted'); readPermissions(m.deps); expect(m.sp.isTrustedAccessibilityClient).toHaveBeenCalledWith(false); });
  it('dismiss -> limited mode, reopen shows guide', () => { const m = mk(false, 'denied'); const p = new PermissionMonitor(m.deps, () => {}, () => {});
    expect(p.dismiss()).toMatchObject({ showGuide: false, limited: true }); expect(p.showGuide()).toMatchObject({ showGuide: true }); p.stopPolling(); });
  it('polls and fires onAllGranted once when granted', () => { vi.useFakeTimers(); const m = mk(false, 'denied'); const ok = vi.fn(); const ch = vi.fn();
    const p = new PermissionMonitor(m.deps, ch, ok, 2000); p.start(); expect(ok).not.toHaveBeenCalled();
    m.sp.ax = true; vi.advanceTimersByTime(2000); expect(ok).not.toHaveBeenCalled(); m.sp.scr = 'granted'; vi.advanceTimersByTime(2000);
    expect(ok).toHaveBeenCalledTimes(1); expect(p.state.showGuide).toBe(false); vi.advanceTimersByTime(10000); expect(ok).toHaveBeenCalledTimes(1); expect(ch).toHaveBeenCalled(); vi.useRealTimers(); });
  it('start fires immediately when already granted', () => { const ok = vi.fn(); new PermissionMonitor(mk(true, 'granted').deps, () => {}, ok).start(); expect(ok).toHaveBeenCalledTimes(1); });
  it('open and request use right APIs', async () => { const m = mk(false, 'not-determined'); const p = new PermissionMonitor(m.deps, () => {}, () => {});
    await p.open('screen'); expect(m.deps.openExternal).toHaveBeenCalledWith(PANE_URL.screen); expect(PANE_URL.accessibility).toContain('Privacy_Accessibility');
    await p.request('accessibility'); expect(m.sp.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    await p.request('screen'); expect(m.deps.getScreenSources).toHaveBeenCalled(); p.stopPolling(); });
});
