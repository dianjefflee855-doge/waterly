import { resPath } from '../platform/mac/resources';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { Rect } from '../core/types';

export interface OcrLine { box: [number, number, number, number]; text: string; score: number }
export interface OcrEngine { recognize(file: string, region?: Rect, scale?: number): Promise<OcrLine[]>; close(): Promise<void> }

export function defaultPython(): string {
  if (process.env.WATERLY_PYTHON) return process.env.WATERLY_PYTHON;
  // dev venv, then the Mac dev checkout's venv (packaged app reuses it), else system python3
  for (const p of [process.env.WATERLY_PYTHON, path.resolve(__dirname, '../../.venv/bin/python'), path.join(require('os').homedir(), 'waterly_tmp/waterly/.venv/bin/python')])
    if (p && fs.existsSync(p)) return p;
  return 'python3';
}

/** RapidOCR (onnxruntime) Python sidecar over JSON lines. */
export class RapidOcrSidecar implements OcrEngine {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending = new Map<number, (v: any) => void>();
  private seq = 0;
  lastMs = 0;
  timeoutMs = 30000;
  constructor(private python = defaultPython(), private script = resPath('sidecar/ocr_server.py')) {}
  private start() {
    if (this.ready) return this.ready;
    this.proc = spawn(this.python, [this.script], { stdio: 'pipe' });
    const rl = readline.createInterface({ input: this.proc.stdout });
    const proc = this.proc;
    this.ready = new Promise((res, rej) => {
      proc.on('error', rej);
      proc.on('exit', (c, sig) => {
        const err = new Error(`ocr sidecar exited code=${c} signal=${sig}`);
        rej(err);
        // fail all in-flight requests and allow a fresh restart on next call (crash must not hang callers)
        for (const cb of this.pending.values()) cb({ error: err.message });
        this.pending.clear();
        if (this.proc === proc) { this.proc = undefined; this.ready = undefined; }
      });
      rl.on('line', l => {
        let m: any; try { m = JSON.parse(l); } catch { return; }
        if (m.ready) return res();
        const cb = this.pending.get(m.id); if (cb) { this.pending.delete(m.id); cb(m); }
      });
    });
    return this.ready;
  }
  async recognize(file: string, region?: Rect, scale = 1): Promise<OcrLine[]> {
    await this.start();
    const id = ++this.seq;
    const r: any = await new Promise(res => {
      const t = setTimeout(() => { if (this.pending.delete(id)) res({ error: 'ocr timeout' }); }, this.timeoutMs);
      this.pending.set(id, (v: any) => { clearTimeout(t); res(v); });
      this.proc!.stdin.write(JSON.stringify({ id, path: path.resolve(file), region: region ? [region.x, region.y, region.w, region.h] : null, scale }) + '\n');
    });
    if (r.error) throw new Error(r.error);
    this.lastMs = r.ms; return r.lines;
  }
  async close() { this.proc?.stdin.end(); this.proc?.kill(); }
}
