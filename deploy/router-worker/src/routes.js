/**
 * Which Cloudflare Pages project serves each path on me-momo.co.in.
 * To add a project: deploy it to Pages (built with its path as Vite `base`),
 * add a line here and push (the Worker redeploys). The Worker owns the
 * whole domain, so no new route is needed.
 */
export const PROJECTS = {
  '/three/galaxy-sandbox': 'galaxy-sandbox.pages.dev',
};

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
