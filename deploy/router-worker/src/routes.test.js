import { describe, it, expect } from 'vitest';
import { route, wantsNotFoundPage } from './routes.js';

const projects = { '/three/galaxy-sandbox': 'galaxy-sandbox.pages.dev', '/my-new-project': 'my-new-project.pages.dev' };
const at = (path) => route(new URL(`https://me-momo.co.in${path}`), projects);

describe('router worker', () => {
  it('strips the prefix and keeps the query', () => {
    expect(at('/three/galaxy-sandbox/')).toEqual({ target: 'https://galaxy-sandbox.pages.dev/' });
    expect(at('/three/galaxy-sandbox/assets/index-abc.js?v=1')).toEqual({ target: 'https://galaxy-sandbox.pages.dev/assets/index-abc.js?v=1' });
    expect(at('/my-new-project/a/b')).toEqual({ target: 'https://my-new-project.pages.dev/a/b' });
  });

  it('adds the trailing slash to a bare prefix', () => {
    expect(at('/three/galaxy-sandbox?x=1')).toEqual({ redirect: 'https://me-momo.co.in/three/galaxy-sandbox/?x=1' });
  });

  it('leaves other paths alone, including look-alike prefixes', () => {
    expect(at('/')).toBeNull();
    expect(at('/three/galaxy-sandbox-old/')).toBeNull();
    expect(at('/three/abc/')).toBeNull();
  });
});

describe('shared 404 page', () => {
  const req = (accept, method = 'GET') => new Request('https://me-momo.co.in/nope', { method, headers: { accept } });
  const res = (status) => new Response(null, { status });
  const html = 'text/html,application/xhtml+xml,*/*;q=0.8';

  it('replaces a 404 for a page request', () => {
    expect(wantsNotFoundPage(req(html), res(404))).toBe(true);
  });

  it('keeps other answers and non-page requests as they are', () => {
    expect(wantsNotFoundPage(req(html), res(200))).toBe(false);
    expect(wantsNotFoundPage(req('*/*'), res(404))).toBe(false); // script, image, fetch()
    expect(wantsNotFoundPage(req(html, 'POST'), res(404))).toBe(false);
  });
});
