import { NOT_FOUND_HOST, proxyRequest, route, wantsNotFoundPage } from './routes.js';
import { countVisit } from './visits.js';

/**
 * Router for me-momo.co.in: owns the domain (Worker custom domains for
 * me-momo.co.in and www), sends each project path to its own Pages project
 * or server (src/routes.js), and passes everything else to the main site Worker
 * through the SITE service binding (wrangler.toml). A 404 for a page request
 * from any of them is replaced by the shared 404 page (momo-404).
 * Every page load is counted on the final answer (src/visits.js).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const r = route(url);
    if (r && 'redirect' in r) return Response.redirect(r.redirect, 301);
    const response = await answer(request, env, r);
    countVisit(env, request, response);
    return response;
  },
};

/**
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {{ target: string } | null} r
 */
async function answer(request, env, r) {
  // Same method, headers and body; only the URL changes (servers also get their secret header).
  const response = r
    ? await fetch(proxyRequest(request, r.target, env))
    : env.SITE
      ? await env.SITE.fetch(request)
      : new Response('Not found', { status: 404 });
  if (!wantsNotFoundPage(request, response)) return response;
  // Served at the missing URL; its assets load from /_404/. If it is down, keep the original 404.
  const page = await fetch(`https://${NOT_FOUND_HOST}/`);
  return page.ok ? new Response(page.body, { status: 404, headers: page.headers }) : response;
}
