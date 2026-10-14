export interface Rect { x: number; y: number; w: number; h: number }
export interface WindowInfo {
  windowId: string;      // Mac: CGWindowID; Win: hwnd
  pid: number;
  bundleId: string;      // Mac bundle id / Win exe name
  title: string;
  bounds: Rect;
  onScreen: boolean;
}
export interface Frame {
  windowId: string;
  width: number; height: number;
  data: Uint8Array;      // RGBA
  source?: string;       // file path (fake) — used by OCR sidecar
  capturedAt: number;
}
export type Speaker = 'self' | 'other';
export interface ChatMessage { speaker: Speaker; text: string; box: [number, number, number, number] }
export interface PermissionStatus { accessibility: boolean; screenRecording: boolean }
export interface FocusState { bundleId: string; pid: number; windowId: string | null }
