import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DAYS,
  MAX_DAYS,
  VISITS_LIMIT,
  handleAdmin,
  isAdminPath,
  keyMatches,
  parseDays,
  queriesFor,
  visitsQuery,
} from './admin.js';

const env = { ADMIN_KEY: 'correct horse battery staple', CF_ACCOUNT_ID: 'acc123', CF_API_TOKEN: 'tok456' };
const get = (path, key) =>
  new Request(`https://me-momo.co.in${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

/** A fake SQL API: answers each query with rows, and records the calls. */
function fakeSql(rowsFor = () => []) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ meta: [], data: rowsFor(init.body), rows: 0 }), { status: 200 });
  };
  return { calls, fetchFn };
}

describe('admin paths', () => {
  it('matches /admin and below only', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin/api')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/x/admin')).toBe(false);
  });
});

describe('keyMatches', () => {
  it('accepts only the exact key as a Bearer token', async () => {
    expect(await keyMatches(`Bearer ${env.ADMIN_KEY}`, env.ADMIN_KEY)).toBe(true);
    expect(await keyMatches(`Bearer ${env.ADMIN_KEY}x`, env.ADMIN_KEY)).toBe(false);
    expect(await keyMatches('Bearer correct', env.ADMIN_KEY)).toBe(false);
    expect(await keyMatches(env.ADMIN_KEY, env.ADMIN_KEY)).toBe(false); // no "Bearer "
    expect(await keyMatches(null, env.ADMIN_KEY)).toBe(false);
  });

  it('refuses every key when the secret is missing or empty', async () => {
    expect(await keyMatches('Bearer ', '')).toBe(false);
    expect(await keyMatches('Bearer undefined', undefined)).toBe(false);
  });
});

describe('parseDays', () => {
  it('takes a whole number from 1 to the limit', () => {
    expect(parseDays('1')).toBe(1);
    expect(parseDays('30')).toBe(30);
    expect(parseDays('500')).toBe(MAX_DAYS);
  });

  it('falls back to the default for anything else', () => {
    for (const bad of [null, '', '0', '-3', '2.5', 'abc', "7'; DROP"]) expect(parseDays(bad)).toBe(DEFAULT_DAYS);
  });
});

describe('queriesFor', () => {
  it('counts with SUM(_sample_interval), never COUNT()', () => {
    for (const sql of Object.values(queriesFor(7))) {
      expect(sql).toContain('SUM(_sample_interval) AS views');
      expect(sql).not.toMatch(/COUNT\(/i);
      expect(sql).toContain('FROM momo_visits');
      expect(sql).toContain("WHERE timestamp > NOW() - INTERVAL '7' DAY");
      expect(sql).toMatch(/FORMAT JSON$/);
    }
  });

  it('groups by the right blobs', () => {
    const q = queriesFor(7);
    expect(q.routes).toBe(
      "SELECT blob1 AS path, SUM(_sample_interval) AS views FROM momo_visits WHERE timestamp > NOW() - INTERVAL '7' DAY " +
        'GROUP BY path ORDER BY views DESC LIMIT 25 FORMAT JSON',
    );
    expect(q.cities).toContain('blob4 AS city, blob3 AS region, blob2 AS country');
    expect(q.cities).toContain('GROUP BY city, region, country');
    expect(q.statuses).toContain('blob5 AS status');
    expect(q.referrers).toContain('blob9 AS referrer');
    expect(q.languages).toContain('blob10 AS language');
    expect(q.notFound).toContain("AND blob5 = '404' GROUP BY path");
  });

  it('uses hours for 1-2 days and days for longer', () => {
    expect(queriesFor(1).series).toContain("toStartOfInterval(timestamp, INTERVAL '1' HOUR) AS t");
    expect(queriesFor(2).series).toContain("INTERVAL '1' HOUR");
    expect(queriesFor(30).series).toContain("toStartOfInterval(timestamp, INTERVAL '1' DAY) AS t");
    expect(queriesFor(30).series).toContain('GROUP BY t ORDER BY t');
  });
});

describe('visitsQuery', () => {
  it('reads single page loads, newest first, with the sample weight', () => {
    expect(visitsQuery(1)).toBe(
      'SELECT timestamp, blob1 AS path, blob2 AS country, blob3 AS region, blob4 AS city, ' +
        'blob5 AS status, blob6 AS device, blob7 AS browser, blob8 AS os, blob9 AS referrer, blob10 AS language, ' +
        "_sample_interval AS views FROM momo_visits WHERE timestamp > NOW() - INTERVAL '1' DAY " +
        `ORDER BY timestamp DESC LIMIT ${VISITS_LIMIT} FORMAT JSON`,
    );
  });
});

describe('handleAdmin', () => {
  it('serves the table rows from /admin/api/visits with one query', async () => {
    const { calls, fetchFn } = fakeSql(() => [{ timestamp: '2026-10-28 10:00:00', path: '/', status: '200', views: '1' }]);
    const res = await handleAdmin(get('/admin/api/visits?days=1', env.ADMIN_KEY), env, fetchFn);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBe(visitsQuery(1));
    expect(await res.json()).toEqual({
      days: 1,
      limit: VISITS_LIMIT,
      visits: [{ time: '2026-10-28 10:00:00', path: '/', status: '200', weight: 1 }],
    });
    expect((await handleAdmin(get('/admin/api/visits'), env, fetchFn)).status).toBe(401);
  });

  it('serves the page without a key, never indexed or cached', async () => {
    const res = await handleAdmin(get('/admin'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('answers 401 for a bad key and runs no query', async () => {
    const { calls, fetchFn } = fakeSql();
    for (const key of [undefined, 'wrong']) {
      const res = await handleAdmin(get('/admin/api', key), env, fetchFn);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(calls).toHaveLength(0);
  });

  it('runs every query against the SQL API and returns the report', async () => {
    const { calls, fetchFn } = fakeSql((sql) =>
      sql.includes('AS t,') ? [{ t: '2026-10-28 00:00:00', views: '3' }, { t: '2026-10-29 00:00:00', views: '4' }] : [{ path: '/', views: '5' }],
    );
    const res = await handleAdmin(get('/admin/api?days=30', env.ADMIN_KEY), env, fetchFn);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toHaveLength(Object.keys(queriesFor(30)).length);
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.authorization).toBe('Bearer tok456');
    expect(body.days).toBe(30);
    expect(body.step).toBe('day');
    expect(body.total).toBe(7);
    expect(body.routes).toEqual([{ path: '/', views: 5 }]);
  });

  it('trims spaces and line breaks around the account ID and token', async () => {
    const { calls, fetchFn } = fakeSql();
    await handleAdmin(get('/admin/api', env.ADMIN_KEY), { ...env, CF_ACCOUNT_ID: ' acc123\r\n', CF_API_TOKEN: 'tok456\n' }, fetchFn);
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql');
    expect(calls[0].init.headers.authorization).toBe('Bearer tok456');
  });

  it('reports a failed SQL call as 502, and missing secrets as 500', async () => {
    const failing = async () => new Response('bad token', { status: 403 });
    const res = await handleAdmin(get('/admin/api', env.ADMIN_KEY), env, failing);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('SQL API 403');
    const noToken = await handleAdmin(get('/admin/api', env.ADMIN_KEY), { ADMIN_KEY: env.ADMIN_KEY }, failing);
    expect(noToken.status).toBe(500);
  });

  it('answers 404 for other admin paths and 405 for other methods', async () => {
    expect((await handleAdmin(get('/admin/other'), env)).status).toBe(404);
    const post = new Request('https://me-momo.co.in/admin/api', { method: 'POST' });
    expect((await handleAdmin(post, env)).status).toBe(405);
  });
});
