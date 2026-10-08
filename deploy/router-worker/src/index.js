import { route } from './routes.js';

/**
 * Router for me-momo.co.in: owns the domain (Worker custom domains for
 * me-momo.co.in and www), sends each project path to its own Pages project
 * (src/routes.js), and passes everything else to the main site Worker
 * through the SITE service binding (wrangler.toml).
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const r = route(url);
    if (!r) return env.SITE ? env.SITE.fetch(request) : new Response('Not found', { status: 404 });
    if ('redirect' in r) return Response.redirect(r.redirect, 301);
    // Same method, headers and body; only the URL changes.
    return fetch(new Request(r.target, request));
  },
};
