/** Site path with the configured base, always ending in `/` when `path` is a page. */
export function withBase(path = ''): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.replace(/^\//, '');
  return `${base}${clean}`;
}

export function normalizePath(path: string): string {
  if (path === '') return '/';
  return path.endsWith('/') ? path : `${path}/`;
}
