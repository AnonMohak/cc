import { route } from './routes.js';

/**
 * Router for me-momo.co.in: sends each project path to its own Pages
 * project (src/routes.js), so every project deploys on its own.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const r = route(url);
    if (!r) return fetch(request);
    if ('redirect' in r) return Response.redirect(r.redirect, 301);
    // Same method, headers and body; only the URL changes.
    return fetch(new Request(r.target, request));
  },
};
