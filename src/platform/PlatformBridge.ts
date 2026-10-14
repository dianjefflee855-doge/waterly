import { Frame, FocusState, PermissionStatus, Rect, WindowInfo } from '../core/types';

/** OS layer. Only this interface differs between macOS (phase 1) and Windows (phase 2). */
export interface PlatformBridge {
  checkPermissions(): Promise<PermissionStatus>;
  enumerateWindows(bundleIds?: string[]): Promise<WindowInfo[]>;
  capture(windowId: string, region?: Rect): Promise<Frame>;
  /** Activate the owning app and raise the window. */
  raise(windowId: string): Promise<void>;
  /** Current frontmost app + focused window. */
  getFocus(): Promise<FocusState>;
  /** Click at window-relative coordinates. */
  click(windowId: string, x: number, y: number): Promise<void>;
  /** Write clipboard (saving the user's previous clipboard) and press paste shortcut. */
  paste(text: string): Promise<void>;
  /** Press a key combo, e.g. "Return" or "Cmd+Return". */
  pressKey(combo: string): Promise<void>;
  restoreClipboard(): Promise<void>;
}

/** True only if frontmost app AND focused window equal the target. */
export async function verifyFocus(bridge: PlatformBridge, target: WindowInfo): Promise<boolean> {
  const f = await bridge.getFocus();
  return f.bundleId === target.bundleId && f.pid === target.pid && f.windowId === target.windowId;
}
