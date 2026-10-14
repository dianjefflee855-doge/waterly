// macOS permission detection + onboarding state (client only). Pure logic is injectable for tests.
export type PermStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';
export type PermId = 'accessibility' | 'screen';
export interface PermState { supported: boolean; accessibility: PermStatus; screen: PermStatus; allGranted: boolean; dismissed: boolean; showGuide: boolean; limited: boolean; }
export interface PermDeps {
  platform: string;
  systemPreferences: { isTrustedAccessibilityClient(prompt: boolean): boolean; getMediaAccessStatus(t: string): string };
  openExternal(url: string): Promise<unknown> | unknown;
  getScreenSources?(): Promise<unknown>;
}
export const PANE_URL: Record<PermId, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};
const norm = (s: unknown): PermStatus => (['granted', 'denied', 'not-determined', 'restricted'].includes(String(s)) ? (s as PermStatus) : 'unknown');

export function readPermissions(d: PermDeps, dismissed = false): PermState {
  if (d.platform !== 'darwin') return { supported: false, accessibility: 'granted', screen: 'granted', allGranted: true, dismissed: false, showGuide: false, limited: false };
  let accessibility: PermStatus = 'unknown', screen: PermStatus = 'unknown';
  try { accessibility = d.systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'; } catch {}
  try { screen = norm(d.systemPreferences.getMediaAccessStatus('screen')); } catch {}
  const allGranted = accessibility === 'granted' && screen === 'granted';
  return { supported: true, accessibility, screen, allGranted, dismissed, showGuide: !allGranted && !dismissed, limited: !allGranted };
}
export const changed = (a: PermState | null, b: PermState) => !a || a.accessibility !== b.accessibility || a.screen !== b.screen || a.dismissed !== b.dismissed;

export class PermissionMonitor {
  state: PermState; private dismissed = false; private timer: any = null; private wasGranted: boolean;
  constructor(private d: PermDeps, private onChange: (s: PermState) => void, private onAllGranted: () => void, private intervalMs = 2000) {
    this.state = readPermissions(d); this.wasGranted = this.state.allGranted;
  }
  /** Call once at startup. Fires onAllGranted immediately if already granted; otherwise polls. */
  start() { if (this.state.allGranted) { safe(this.onAllGranted); return; } this.ensurePolling(); }
  refresh(): PermState {
    const s = readPermissions(this.d, this.dismissed); const c = changed(this.state, s); this.state = s;
    if (c) safe(() => this.onChange(s));
    if (s.allGranted && !this.wasGranted) { this.wasGranted = true; this.stopPolling(); safe(this.onAllGranted); }
    return s;
  }
  async open(id: PermId) { if (!this.state.supported || !PANE_URL[id]) return false; try { await this.d.openExternal(PANE_URL[id]); return true; } catch { return false; } }
  async request(id: PermId) {
    if (!this.state.supported) return this.state;
    try {
      if (id === 'accessibility') this.d.systemPreferences.isTrustedAccessibilityClient(true);
      else if (id === 'screen' && this.d.getScreenSources) await this.d.getScreenSources(); // registers app in Screen Recording list / triggers prompt
    } catch {}
    this.ensurePolling(); return this.refresh();
  }
  dismiss() { this.dismissed = true; return this.refresh(); }
  showGuide() { this.dismissed = false; this.ensurePolling(); return this.refresh(); }
  ensurePolling() { if (!this.timer && !this.state.allGranted) this.timer = setInterval(() => this.refresh(), this.intervalMs); }
  stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
function safe(f: () => void) { try { f(); } catch {} }
