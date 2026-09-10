import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = new URL('../', import.meta.url).pathname;
for (const dir of ['dist', 'dist/src', 'scripts', 'supabase/functions/realtime-session']) {
  for (const name of readdirSync(path.join(root, dir))) if (/\.(js|mjs)$/.test(name)) execFileSync(process.execPath, ['--check', path.join(root, dir, name)]);
}
const html = readFileSync(path.join(root, 'dist/index.html'), 'utf8');
for (const [, file] of html.matchAll(/(?:src|href)="\.\/([^"#]*)"/g)) if (file && !existsSync(path.join(root, 'dist', file))) throw new Error(`Missing asset ${file}`);
const manifest = JSON.parse(readFileSync(path.join(root, 'dist/manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) if (!existsSync(path.join(root, 'dist', icon.src))) throw new Error(`Missing icon ${icon.src}`);
if (manifest.scope !== './' || manifest.start_url !== './') throw new Error('PWA must support GitHub Pages subpaths');
console.log('JavaScript syntax, HTML assets, and PWA manifest passed.');
