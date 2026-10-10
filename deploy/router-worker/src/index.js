import { NOT_FOUND_HOST, route, wantsNotFoundPage } from './routes.js';

/**
 * Router for me-momo.co.in: owns the domain (Worker custom domains for
 * me-momo.co.in and www), sends each project path to its own Pages project
 * (src/routes.js), and passes everything else to the main site Worker
 * through the SITE service binding (wrangler.toml). A 404 for a page request
 * from any of them is replaced by the shared 404 page (momo-404).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const r = route(url);
    if (r && 'redirect' in r) return Response.redirect(r.redirect, 301);
    // Same method, headers and body; only the URL changes.
    const response = r
      ? await fetch(new Request(r.target, request))
      : env.SITE
        ? await env.SITE.fetch(request)
        : new Response('Not found', { status: 404 });
    if (!wantsNotFoundPage(request, response)) return response;
    // Served at the missing URL; its assets load from /_404/. If it is down, keep the original 404.
    const page = await fetch(`https://${NOT_FOUND_HOST}/`);
    return page.ok ? new Response(page.body, { status: 404, headers: page.headers }) : response;
  },
};
