/**
 * Where the web fonts come from, in order of preference. The inline loader in
 * Layout.astro tries each one's CSS with a timeout and uses the first that
 * answers; the page's own build-time subset (scripts/subset-fonts.mjs) is the
 * last resort and needs no entry here. Edit this list to reorder or add CDNs.
 *
 * Every source must serve the same families: "Noto Serif SC" 400/700/900 and
 * "UnifrakturMaguntia" 400, as unicode-range slices (so a page only downloads
 * the slices its characters need) with CORS on both the CSS and the fonts.
 * (Bunny Fonts was checked and left out: its Noto Serif SC faces have no
 * unicode-range, so a browser would fetch every slice, about 14 MB.)
 */
export type FontSource = {
  id: string;
  /** Stylesheets to load (all of them; any failure fails the source). */
  css: string[];
  /** Origins to preconnect to once the source is chosen (CSS host, font host). */
  preconnect: string[];
};

const GOOGLE_QUERY = 'family=Noto+Serif+SC:wght@400;700;900&family=UnifrakturMaguntia&display=swap';
const FONTSOURCE = (host: string) => [
  `${host}/npm/@fontsource/noto-serif-sc@5.3.0/400.css`,
  `${host}/npm/@fontsource/noto-serif-sc@5.3.0/700.css`,
  `${host}/npm/@fontsource/noto-serif-sc@5.3.0/900.css`,
  `${host}/npm/@fontsource/unifrakturmaguntia@5.3.0/400.css`,
];

export const FONT_SOURCES: FontSource[] = [
  {
    id: 'google',
    css: [`https://fonts.googleapis.com/css2?${GOOGLE_QUERY}`],
    preconnect: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
  },
  {
    id: 'loli',
    css: [`https://fonts.loli.net/css2?${GOOGLE_QUERY}`],
    preconnect: ['https://fonts.loli.net', 'https://gstatic.loli.net'],
  },
  {
    id: 'jsdelivr',
    css: FONTSOURCE('https://cdn.jsdelivr.net'),
    preconnect: ['https://cdn.jsdelivr.net'],
  },
];

/** How long one source's CSS may take before the next one is tried. */
export const FONT_PROBE_TIMEOUT_MS = 1200;
/** If none of a CDN's font files has arrived this long after its CSS, the self-hosted subset is used. */
export const FONT_FILE_TIMEOUT_MS = 4000;
/** How long the source that worked is used first on later visits. */
export const FONT_SOURCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
