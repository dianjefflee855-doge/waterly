import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
/** Load KEY=VALUE from ~/.config/waterly/.env into process.env (never logs values). */
export function loadWaterlyEnv(file = path.join(os.homedir(), '.config/waterly/.env')): boolean {
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m) continue;
    const v = m[2].replace(/^['"]|['"]$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
  return true;
}
