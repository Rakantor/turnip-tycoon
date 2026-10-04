export const hashRouting = import.meta.env.MODE === 'pages';

export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}

export function appUrl(path: string): string {
  const base = new URL(import.meta.env.BASE_URL, location.origin);
  return new URL(hashRouting ? `#${path}` : path.replace(/^\/+/, ''), base).href;
}
