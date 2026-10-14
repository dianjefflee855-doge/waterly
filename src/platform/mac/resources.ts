import * as path from 'path'; import * as fs from 'fs';
/** Resolve a bundled resource: packaged app -> Contents/Resources/<rel>; dev -> repo root/<rel>. */
export function resPath(rel: string): string {
  const rp = (process as any).resourcesPath as string | undefined;
  if (rp && fs.existsSync(path.join(rp, rel))) return path.join(rp, rel);
  return path.resolve(__dirname, '../../..', rel);
}
