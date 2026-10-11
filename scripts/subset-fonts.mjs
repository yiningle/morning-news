/**
 * Post-build: the display web fonts of every built page, cut to exactly the
 * characters its display text contains.
 *
 * Body text uses the reader's system serif (see paper.css). Only the DISPLAY
 * elements below use web fonts: Noto Serif SC Black (900, as "Morning
 * Display") and UnifrakturMaguntia (Latin only). For each dist/**\/*.html the
 * text of those elements is collected and the vendored fonts in src/fonts are
 * subset to it (harfbuzz, via subset-font) into content-hashed woff2 files
 * under dist/_fonts/. The page's `__DISPLAY_FONTS__` placeholder becomes a
 * high-priority preload per file plus the @font-face rules, inside a
 * <noscript> that Layout.astro's loader reads (and that applies as-is when
 * JavaScript is off). URLs are relative, so the output works under any base.
 *
 * Keep DISPLAY in step with the rules in paper.css that use var(--display)
 * or UnifrakturMaguntia.
 *
 * usage: node scripts/subset-fonts.mjs [distDir]
 */
import { createHash } from 'node:crypto';
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'fontkitten';
import subsetFont from 'subset-font';
import { ELEMENT_NODE, TEXT_NODE, parse } from 'ultrahtml';
import { querySelectorAll } from 'ultrahtml/selector';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, process.argv[2] ?? 'dist');
const fontsDir = join(root, 'src', 'fonts');
const outDir = join(dist, '_fonts');
mkdirSync(outDir, { recursive: true });

/* The display elements, per face. `first` = only the start of the first paragraph (a ::first-letter drop cap). */
const DISPLAY = [
  {
    family: 'Morning Display',
    weight: 900,
    // Latin glyphs from the Latin file, everything else from the simplified-Chinese one.
    files: [{ name: 'noto-serif-sc-latin-900-normal', latin: true }, { name: 'noto-serif-sc-chinese-simplified-900-normal' }],
    selectors: ['.masthead-title', '.inside-title', '.story-title', '.section-display', '.stat-title', '.briefs-label', '.pull-quote', '.debate-title', '.guide-item b'],
    first: ['.story-lead .story-body', '.story-section-lead .story-body'],
  },
  {
    family: 'UnifrakturMaguntia',
    weight: 400,
    files: [{ name: 'unifrakturmaguntia-latin-400-normal', latin: true }],
    selectors: ['.mast-en', '.guide-title', '.section-en'],
    first: [],
  },
];

const decode = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');

function textOf(node) {
  if (node.type === TEXT_NODE) return decode(node.value);
  if (node.type !== ELEMENT_NODE && node.type !== 0) return '';
  if (node.type === ELEMENT_NODE && (node.name === 'script' || node.name === 'style')) return '';
  return (node.children ?? []).map(textOf).join('');
}

function displayText(doc, face) {
  let text = face.selectors.flatMap((sel) => querySelectorAll(doc, sel)).map(textOf).join('');
  for (const sel of face.first) {
    for (const body of querySelectorAll(doc, sel)) {
      const p = (body.children ?? []).find((child) => child.type === ELEMENT_NODE && child.name === 'p');
      // ::first-letter takes leading punctuation with the letter.
      if (p) text += [...textOf(p).trimStart()].slice(0, 3).join('');
    }
  }
  return text;
}

const sources = new Map();
function source(name) {
  if (!sources.has(name)) {
    const buffer = readFileSync(join(fontsDir, `${name}.woff2`));
    sources.set(name, { buffer, cmap: new Set(create(buffer).characterSet) });
  }
  return sources.get(name);
}

const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 10);
const range = (codes) => codes.map((c) => `U+${c.toString(16).toUpperCase()}`).join(',');
const isLatin = (c) => c < 0x2000;

const fileCache = new Map();
async function subsetFile(name, codes) {
  const key = `${name}:${codes.join(',')}`;
  if (!fileCache.has(key)) {
    fileCache.set(key, (async () => {
      const data = await subsetFont(source(name).buffer, String.fromCodePoint(...codes), { targetFormat: 'woff2' });
      const file = `${name.replace(/-normal$/, '')}.${hash(data)}.woff2`;
      writeFileSync(join(outDir, file), data);
      return { file, bytes: data.length };
    })());
  }
  return fileCache.get(key);
}

const missing = new Set();
async function facesFor(doc) {
  const out = [];
  for (const face of DISPLAY) {
    const text = displayText(doc, face);
    let left = [...new Set([...text].map((ch) => ch.codePointAt(0)))].filter((c) => c > 32 && c !== 0x3000).sort((a, b) => a - b);
    const parts = [];
    for (const file of face.files) {
      const cmap = source(file.name).cmap;
      const mine = left.filter((c) => (!file.latin || isLatin(c)) && cmap.has(c));
      left = left.filter((c) => !mine.includes(c));
      if (mine.length) parts.push({ name: file.name, codes: mine });
    }
    left.forEach((c) => missing.add(`${face.family}:${String.fromCodePoint(c)}`));
    for (const part of parts) {
      const result = await subsetFile(part.name, part.codes);
      // An exact unicode-range only where one family has more than one file.
      out.push({ ...result, family: face.family, weight: face.weight, codes: part.codes, range: parts.length > 1 ? range(part.codes) : null });
    }
  }
  return out;
}

const started = Date.now();
const pages = globSync('**/*.html', { cwd: dist });
for (const page of pages) {
  const path = join(dist, page);
  const html = readFileSync(path, 'utf8');
  const placeholder = /<meta name="display-fonts" content="__DISPLAY_FONTS__"\s*\/?>/;
  if (!placeholder.test(html)) continue;
  const faces = await facesFor(parse(html));
  const href = (file) => relative(dirname(path), join(outDir, file)).split(sep).join('/');
  const bytes = faces.reduce((sum, face) => sum + face.bytes, 0);
  const preload = faces.map((face) => `<link rel="preload" href="${href(face.file)}" as="font" type="font/woff2" crossorigin fetchpriority="high">`).join('');
  const rules = faces
    .map((face) => `@font-face{font-family:"${face.family}";font-style:normal;font-weight:${face.weight};font-display:swap;src:url(${href(face.file)}) format("woff2")${face.range ? `;unicode-range:${face.range}` : ''}}`)
    .join('');
  const block = `${preload}<noscript id="display-fonts" data-bytes="${bytes}"><style>${rules}</style></noscript>`;
  writeFileSync(path, html.replace(placeholder, () => block));
  console.log(`fonts: ${page}: ${faces.map((f) => `${f.file} ${f.codes.length} chars ${(f.bytes / 1024).toFixed(1)} KB`).join(', ')} = ${(bytes / 1024).toFixed(1)} KB`);
}
if (missing.size) console.log(`fonts: not in the fonts (system fallback): ${[...missing].join(' ')}`);
console.log(`fonts: ${fileCache.size} subset files in ${Date.now() - started} ms`);
