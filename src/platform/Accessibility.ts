/** Optional AX layer (macOS Accessibility). Read-mostly; used to assert chat identity and locate the composer. */
export interface AxElement {
  role: string;
  identifier?: string;   // AXIdentifier
  description?: string;  // AXDescription
  title?: string;        // AXTitle
  value?: string;        // AXValue
  settable?: boolean;    // AXValue settable
  numChars?: number;     // AXNumberOfCharacters (contents never read)
  frame?: { x: number; y: number; w: number; h: number }; // window-relative
}
export interface AxQuery { identifier?: string; description?: string; role?: string }
export interface AccessibilityBridge {
  /** Find elements in the given window matching all provided fields. */
  find(windowId: string, q: AxQuery): Promise<AxElement[]>;
  /** Give keyboard focus to an element (AXFocused=true). */
  focus(windowId: string, el: AxElement): Promise<void>;
  /** Element that currently has keyboard focus in that window, if any. */
  focusedElement(windowId: string): Promise<AxElement | null>;
}
