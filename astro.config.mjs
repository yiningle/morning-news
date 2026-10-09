// @ts-check
import { defineConfig } from 'astro/config';

/**
 * Public sub-path for the static build.
 * `BASE_PATH=/hn-preview/` (the default) or `BASE_PATH=/hn/`.
 * Astro stores `base` without a trailing slash, then `trailingSlash: 'always'`
 * puts the slash back so `import.meta.env.BASE_URL` ends with `/`.
 * @param {string | undefined} input
 */
function normalizeBase(input) {
  const raw = (input ?? '').trim();
  const value = raw === '' ? '/hn-preview' : raw;
  if (value === '/') return '/';
  const withLead = value.startsWith('/') ? value : `/${value}`;
  return withLead.endsWith('/') ? withLead.slice(0, -1) : withLead;
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  trailingSlash: 'always',
  output: 'static',
  build: {
    format: 'directory',
  },
  server: {
    host: true,
    port: 4329,
    open: false,
  },
});
