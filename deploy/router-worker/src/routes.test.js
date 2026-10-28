import { describe, it, expect } from 'vitest';
import { proxyRequest, route, wantsNotFoundPage } from './routes.js';

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

describe('servers behind a tunnel', () => {
  const servers = { '/sift': { header: 'x-sift-origin-key', secret: 'SIFT_ORIGIN_KEY' } };
  const env = { SIFT_ORIGIN_KEY: 'the-secret' };
  const target = 'https://sift-origin.me-momo.co.in/api/items';

  it('adds the secret header, keeps the body and does not follow redirects', async () => {
    const request = new Request('https://me-momo.co.in/sift/api/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sift-origin-key': 'from-the-browser' },
      body: '{"title":"A"}',
    });
    const out = proxyRequest(request, target, env, servers);
    expect(out.url).toBe(target);
    expect(out.method).toBe('POST');
    expect(out.headers.get('x-sift-origin-key')).toBe('the-secret');
    expect(out.headers.get('content-type')).toBe('application/json');
    expect(out.redirect).toBe('manual');
    expect(await out.text()).toBe('{"title":"A"}');
  });

  it('without the secret, a header from the browser is removed', () => {
    const request = new Request('https://me-momo.co.in/sift/', { headers: { 'x-sift-origin-key': 'guess' } });
    expect(proxyRequest(request, target, {}, servers).headers.get('x-sift-origin-key')).toBeNull();
  });

  it('leaves Pages projects as they are', () => {
    const request = new Request('https://me-momo.co.in/three/galaxy-sandbox/', { headers: { 'x-sift-origin-key': 'x' } });
    const out = proxyRequest(request, 'https://galaxy-sandbox.pages.dev/', env, servers);
    expect(out.redirect).toBe('follow');
    expect(out.headers.get('x-sift-origin-key')).toBe('x');
  });
});

describe("the visitor's IP address", () => {
  const target = 'https://dakken.pages.dev/api/runs';

  it('goes to every project in x-momo-client-ip, with the body', async () => {
    const request = new Request('https://me-momo.co.in/dakken/api/runs', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.7', authorization: 'Bearer k' },
      body: '{"a":1}',
    });
    const out = proxyRequest(request, target, {}, {});
    expect(out.headers.get('x-momo-client-ip')).toBe('203.0.113.7');
    expect(out.headers.get('authorization')).toBe('Bearer k');
    expect(out.method).toBe('POST');
    expect(await out.text()).toBe('{"a":1}');
  });

  it('a value from the browser is not passed on', () => {
    const request = new Request('https://me-momo.co.in/dakken/', { headers: { 'x-momo-client-ip': '1.2.3.4' } });
    expect(proxyRequest(request, target, {}, {}).headers.get('x-momo-client-ip')).toBeNull();
  });
});
