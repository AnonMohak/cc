/**
 * Which Cloudflare Pages project serves each path on me-momo.co.in.
 * To add a project: deploy it to Pages (built with its path as Vite `base`),
 * add a line here and push (the Worker redeploys). The Worker owns the
 * whole domain, so no new route is needed.
 */
export const PROJECTS = {
  '/three/galaxy-sandbox': 'galaxy-sandbox.pages.dev',
  '/turing-machine': 'turing-machine-59p.pages.dev',
  '/lustro': 'lustro-8t4.pages.dev',
  '/sift': 'sift-origin.me-momo.co.in', // a server behind a Cloudflare Tunnel (see SERVERS)
  '/_404': 'momo-404.pages.dev', // assets of the shared 404 page
};

/**
 * Projects that are a server (behind a Cloudflare Tunnel), not a Pages site.
 * The router adds a secret header from a Worker secret, so the server answers
 * only requests that come through here (set it with
 * `npx wrangler secret put <secret>`). Redirects go to the browser as they are,
 * so sign-in redirects (for example to Google) work.
 */
export const SERVERS = {
  '/sift': { header: 'x-sift-origin-key', secret: 'SIFT_ORIGIN_KEY' },
};

/** Pages host of the shared 404 page (repo momo-404, built with base /_404/). */
export const NOT_FOUND_HOST = 'momo-404.pages.dev';

/**
 * True when a 404 answers a page request, so the shared 404 page should replace it.
 * Missing scripts, images and API calls keep their own 404.
 *
 * @param {Request} request
 * @param {Response} response
 */
export function wantsNotFoundPage(request, response) {
  return (
    response.status === 404 &&
    request.method === 'GET' &&
    (request.headers.get('accept') ?? '').includes('text/html')
  );
}

/**
 * The request to send to the target: the same method, headers and body.
 * Every project gets the visitor's IP address in x-momo-client-ip, because a
 * request from a Worker can carry the Worker's own address in
 * CF-Connecting-IP (a project uses it for rate limits). A value that the
 * browser sends in that header is never passed on.
 * For a server in SERVERS, it also sets the secret header (or removes it when
 * the secret is missing, so the server refuses) and does not follow redirects.
 *
 * @param {Request} request
 * @param {string} target
 * @param {Record<string, unknown>} [env]
 * @param {Record<string, { header: string, secret: string }>} [servers]
 * @returns {Request}
 */
export function proxyRequest(request, target, env = {}, servers = SERVERS) {
  const { pathname } = new URL(request.url);
  const server = Object.entries(servers).find(([prefix]) => pathname.startsWith(`${prefix}/`))?.[1];
  const headers = new Headers(request.headers);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-momo-client-ip', ip);
  else headers.delete('x-momo-client-ip');
  if (!server) return new Request(target, new Request(request, { headers }));
  const key = env[server.secret];
  if (typeof key === 'string' && key) headers.set(server.header, key);
  else headers.delete(server.header);
  return new Request(target, new Request(request, { headers, redirect: 'manual' }));
}

/**
 * Pure routing: where a request URL goes.
 * - `{ redirect }`: the bare prefix gets a trailing slash, so relative URLs
 *   in the page resolve inside the project.
 * - `{ target }`: the same path without the prefix, on the project's host.
 * - `null`: not a project path; pass it to the site as it is.
 *
 * @param {URL} url
 * @param {Record<string, string>} [projects]
 * @returns {{ redirect: string } | { target: string } | null}
 */
export function route(url, projects = PROJECTS) {
  for (const [prefix, host] of Object.entries(projects)) {
    if (url.pathname === prefix) return { redirect: `${url.origin}${prefix}/${url.search}` };
    if (url.pathname.startsWith(`${prefix}/`)) {
      return { target: `https://${host}${url.pathname.slice(prefix.length)}${url.search}` };
    }
  }
  return null;
}
