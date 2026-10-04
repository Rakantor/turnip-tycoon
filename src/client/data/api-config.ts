export function parseApiOrigin(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_API_URL must be an HTTPS API origin.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('VITE_API_URL must be an HTTPS API origin without a path or credentials.');
  }
  return url.origin;
}

export const apiOrigin = parseApiOrigin(import.meta.env.VITE_API_URL as string | undefined);
// Pages projects share an origin, so both the API and the project path scope local data.
export const identityNamespace = apiOrigin
  ? `turnips:${apiOrigin}:${import.meta.env.BASE_URL}`
  : 'turnips';
