import { describe, it, expect } from 'vitest';
import {
  INDEX_MAX_BYTES,
  browserOf,
  countVisit,
  cutBytes,
  deviceOf,
  isPageLoad,
  languageOf,
  osOf,
  referrerOf,
  visitOf,
} from './visits.js';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIpad: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  samsungPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  operaWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

const req = (path = '/', { method = 'GET', headers = {}, cf } = {}) => {
  const r = new Request(`https://me-momo.co.in${path}`, { method, headers });
  if (cf) Object.defineProperty(r, 'cf', { value: cf });
  return r;
};
const res = (status = 200, type = 'text/html; charset=utf-8') =>
  new Response(null, { status, headers: type ? { 'content-type': type } : {} });

describe('isPageLoad', () => {
  it('counts a GET answered with HTML, also a 404 page', () => {
    expect(isPageLoad(req('/'), res())).toBe(true);
    expect(isPageLoad(req('/nope'), res(404))).toBe(true);
    expect(isPageLoad(req('/'), res(200, 'TEXT/HTML'))).toBe(true);
  });

  it('leaves out files, API calls, other methods and redirects', () => {
    expect(isPageLoad(req('/a.js'), res(200, 'text/javascript'))).toBe(false);
    expect(isPageLoad(req('/api'), res(200, 'application/json'))).toBe(false);
    expect(isPageLoad(req('/'), res(200, null))).toBe(false);
    expect(isPageLoad(req('/', { method: 'POST' }), res())).toBe(false);
    expect(isPageLoad(req('/', { method: 'HEAD' }), res())).toBe(false);
    expect(isPageLoad(req('/'), res(302))).toBe(false);
  });

  it('never counts the admin page', () => {
    expect(isPageLoad(req('/admin'), res())).toBe(false);
    expect(isPageLoad(req('/admin/api'), res())).toBe(false);
    expect(isPageLoad(req('/administrator'), res())).toBe(true);
  });
});

describe('user-agent', () => {
  it('finds the device type', () => {
    expect(deviceOf(UA.chromeWin)).toBe('desktop');
    expect(deviceOf(UA.safariMac)).toBe('desktop');
    expect(deviceOf(UA.safariIphone)).toBe('mobile');
    expect(deviceOf(UA.samsungPhone)).toBe('mobile');
    expect(deviceOf(UA.chromeIpad)).toBe('tablet');
    expect(deviceOf(UA.androidTablet)).toBe('tablet');
    expect(deviceOf('')).toBe('unknown');
  });

  it('finds the browser', () => {
    expect(browserOf(UA.chromeWin)).toBe('Chrome');
    expect(browserOf(UA.edgeWin)).toBe('Edge');
    expect(browserOf(UA.operaWin)).toBe('Opera');
    expect(browserOf(UA.samsungPhone)).toBe('Samsung Internet');
    expect(browserOf(UA.firefoxLinux)).toBe('Firefox');
    expect(browserOf(UA.safariIphone)).toBe('Safari');
    expect(browserOf(UA.safariMac)).toBe('Safari');
    expect(browserOf(UA.chromeIpad)).toBe('Chrome');
    expect(browserOf('curl/8.0')).toBe('other');
    expect(browserOf('')).toBe('unknown');
  });

  it('finds the OS', () => {
    expect(osOf(UA.chromeWin)).toBe('Windows');
    expect(osOf(UA.safariIphone)).toBe('iOS');
    expect(osOf(UA.chromeIpad)).toBe('iOS');
    expect(osOf(UA.safariMac)).toBe('macOS');
    expect(osOf(UA.samsungPhone)).toBe('Android');
    expect(osOf(UA.firefoxLinux)).toBe('Linux');
    expect(osOf(UA.chromebook)).toBe('ChromeOS');
    expect(osOf('curl/8.0')).toBe('other');
    expect(osOf('')).toBe('unknown');
  });
});

describe('referrer and language', () => {
  it('keeps only the referring host, without www.', () => {
    expect(referrerOf('https://www.google.com/search?q=galaxy')).toBe('google.com');
    expect(referrerOf('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
    expect(referrerOf(null)).toBe('');
    expect(referrerOf('not a url')).toBe('');
  });

  it('keeps the first language tag', () => {
    expect(languageOf('en-GB,en;q=0.9,de;q=0.8')).toBe('en-gb');
    expect(languageOf('de;q=0.9')).toBe('de');
    expect(languageOf('*')).toBe('');
    expect(languageOf(null)).toBe('');
  });
});

describe('cutBytes', () => {
  it('cuts to the byte limit, never inside a character', () => {
    expect(cutBytes('/short', 96)).toBe('/short');
    expect(new TextEncoder().encode(cutBytes('/' + 'a'.repeat(200), 96)).length).toBe(96);
    // 'é' is 2 bytes: 1 + 47 × 2 = 95, one more would pass 96.
    expect(cutBytes('/' + 'é'.repeat(100), 96)).toBe('/' + 'é'.repeat(47));
  });
});

describe('visitOf', () => {
  it('builds the data point in the order the admin queries read', () => {
    const request = req('/three/galaxy-sandbox/?x=1', {
      headers: { 'user-agent': UA.safariIphone, referer: 'https://www.reddit.com/r/x', 'accept-language': 'fr-FR,fr' },
      cf: { country: 'FR', region: 'Ile-de-France', city: 'Paris' },
    });
    expect(visitOf(request, res(200))).toEqual({
      indexes: ['/three/galaxy-sandbox/'],
      blobs: ['/three/galaxy-sandbox/', 'FR', 'Ile-de-France', 'Paris', '200', 'mobile', 'Safari', 'iOS', 'reddit.com', 'fr-fr'],
      doubles: [1],
    });
  });

  it('fills missing data with empty text and cuts a long path in the index', () => {
    const long = '/' + 'x'.repeat(300);
    const point = visitOf(req(long), res(404));
    expect(point.indexes[0].length).toBe(INDEX_MAX_BYTES);
    expect(point.blobs[0]).toBe(long);
    expect(point.blobs.slice(1, 5)).toEqual(['', '', '', '404']);
    expect(point.blobs[5]).toBe('unknown');
  });
});

describe('countVisit', () => {
  const sink = () => {
    const points = [];
    return { points, env: { VISITS: { writeDataPoint: (p) => points.push(p) } } };
  };

  it('writes one point for a page load only', () => {
    const { points, env } = sink();
    countVisit(env, req('/'), res());
    countVisit(env, req('/app.js'), res(200, 'text/javascript'));
    expect(points).toHaveLength(1);
  });

  it('never throws: no binding, or a failed write', () => {
    expect(() => countVisit({}, req('/'), res())).not.toThrow();
    const env = { VISITS: { writeDataPoint: () => { throw new Error('limit'); } } };
    expect(() => countVisit(env, req('/'), res())).not.toThrow();
  });
});
