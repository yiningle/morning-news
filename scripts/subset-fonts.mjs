/**
 * Post-build: give every built page its own small font subset (self-hosted
 * fallback for the CDN fonts, see src/font-sources.ts and Layout.astro).
 *
 * For each dist/**\/*.html, the characters of its text are cut out of the
 * vendored Noto Serif SC (400/700/900) and UnifrakturMaguntia files into
 * content-hashed woff2 files under dist/_fonts/, with one stylesheet per
 * distinct character set. The page's `__FONT_SUBSET__` placeholders (meta tag
 * and <noscript> link) are replaced with a relative URL to that stylesheet,
 * so the output works under any base path.
 *
 * usage: node scripts/subset-fonts.mjs [distDir]
 */
import { createHash } from 'node:crypto';
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'fontkitten';
import subsetFont from 'subset-font';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, process.argv[2] ?? 'dist');
const fontsDir = join(root, 'src', 'fonts');
const outDir = join(dist, '_fonts');
mkdirSync(outDir, { recursive: true });

/* Text the scripts add at run time (pager, live region) plus printable ASCII. */
const RUNTIME_TEXT = '第版，·/–—“”‘’…' + Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/* Per family and weight: source files in priority order (the first one that has a glyph provides it). */
const FACES = [
  { family: 'Noto Serif SC', weight: 400, files: ['noto-serif-sc-chinese-simplified-400-normal', 'noto-serif-sc-29-400-normal'] },
  { family: 'Noto Serif SC', weight: 700, files: ['noto-serif-sc-chinese-simplified-700-normal', 'noto-serif-sc-29-700-normal'] },
  { family: 'Noto Serif SC', weight: 900, files: ['noto-serif-sc-chinese-simplified-900-normal'] },
  { family: 'UnifrakturMaguntia', weight: 400, files: ['unifrakturmaguntia-latin-400-normal'], latinOnly: true },
];

const sources = new Map();
function source(name) {
  if (!sources.has(name)) {
    const buffer = readFileSync(join(fontsDir, `${name}.woff2`));
    sources.set(name, { buffer, cmap: new Set(create(buffer).characterSet) });
  }
  return sources.get(name);
}

function pageText(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return body
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, '\u00a0');
}

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 10);
const range = (codes) => codes.map((c) => `U+${c.toString(16).toUpperCase()}`).join(', ');

const fileCache = new Map();
async function subsetFile(name, codes) {
  const key = `${name}:${codes.join(',')}`;
  if (fileCache.has(key)) return fileCache.get(key);
  const data = await subsetFont(source(name).buffer, String.fromCodePoint(...codes), { targetFormat: 'woff2' });
  const file = `${name.replace(/-normal$/, '')}.${hash(data)}.woff2`;
  writeFileSync(join(outDir, file), data);
  const result = { file, bytes: data.length };
  fileCache.set(key, result);
  return result;
}

const cssCache = new Map();
async function stylesheetFor(text) {
  const codes = [...new Set([...text, ...RUNTIME_TEXT].map((ch) => ch.codePointAt(0)))].filter((c) => c >= 32).sort((a, b) => a - b);
  const key = codes.join(',');
  if (cssCache.has(key)) return cssCache.get(key);
  const blocks = [];
  let bytes = 0;
  for (const face of FACES) {
    let left = face.latinOnly ? codes.filter((c) => c < 0x2000) : codes;
    face.files.forEach((name, i) => {
      const cmap = source(name).cmap;
      const mine = left.filter((c) => cmap.has(c));
      left = left.filter((c) => !cmap.has(c));
      face[`take${i}`] = mine;
    });
    for (let i = face.files.length - 1; i >= 0; i -= 1) {
      // Rarer sources first with an exact unicode-range, the main file last as the catch-all,
      // the same order the full fonts were declared in.
      const mine = face[`take${i}`];
      if (!mine.length) continue;
      const out = await subsetFile(face.files[i], mine);
      bytes += out.bytes;
      blocks.push(
        `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};font-display:swap;` +
          `src:url(${out.file}) format("woff2")${i > 0 || face.latinOnly ? `;unicode-range:${range(mine)}` : ''}}`,
      );
    }
  }
  const css = `/* self-hosted subset: ${codes.length} characters */\n${blocks.join('\n')}\n`;
  const file = `subset.${hash(css)}.css`;
  writeFileSync(join(outDir, file), css);
  const result = { file, bytes, chars: codes.length };
  cssCache.set(key, result);
  return result;
}

const started = Date.now();
const pages = globSync('**/*.html', { cwd: dist });
for (const page of pages) {
  const path = join(dist, page);
  const html = readFileSync(path, 'utf8');
  if (!html.includes('__FONT_SUBSET__')) continue;
  const sheet = await stylesheetFor(pageText(html));
  const href = relative(dirname(path), join(outDir, sheet.file)).split(sep).join('/');
  writeFileSync(path, html.replaceAll('__FONT_SUBSET__', href));
  console.log(`fonts: ${page} → _fonts/${sheet.file} (${sheet.chars} chars, ${Math.round(sheet.bytes / 1024)} KB)`);
}
console.log(`fonts: ${fileCache.size} subset files, ${cssCache.size} stylesheets in ${Date.now() - started} ms`);
