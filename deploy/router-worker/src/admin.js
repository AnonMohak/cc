import { ADMIN_PAGE } from './adminPage.js';

/**
 * The /admin page and its API: the visit counts (src/visits.js) from the
 * Analytics Engine SQL API. The API needs `Authorization: Bearer <ADMIN_KEY>`.
 * Secrets (npx wrangler secret put): ADMIN_KEY, CF_ACCOUNT_ID, CF_API_TOKEN.
 */

export const DATASET = 'momo_visits';
export const DEFAULT_DAYS = 7;
/** Analytics Engine keeps data for 3 months. */
export const MAX_DAYS = 90;
/** Rows in each ranked list. */
export const LIST_LIMIT = 25;

const NO_INDEX = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};

/** @param {string} pathname */
export function isAdminPath(pathname) {
  return /^\/admin(\/|$)/.test(pathname);
}

/**
 * The days to show: a whole number from 1 to MAX_DAYS, else DEFAULT_DAYS.
 *
 * @param {string | null} value
 */
export function parseDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) return DEFAULT_DAYS;
  return Math.min(days, MAX_DAYS);
}

/**
 * True when the Authorization header carries the admin key. Both sides are
 * hashed first, so the compare takes the same time for any key and any length.
 *
 * @param {string | null} header
 * @param {unknown} secret
 */
export async function keyMatches(header, secret) {
  if (typeof secret !== 'string' || !secret || !header?.startsWith('Bearer ')) return false;
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * The SQL for each part of the report. Each count is SUM(_sample_interval),
 * because Analytics Engine samples the data under heavy traffic.
 * Blob order (src/visits.js): 1 path, 2 country, 3 region, 4 city, 5 status,
 * 6 device, 7 browser, 8 os, 9 referrer, 10 language.
 *
 * @param {number} days a whole number (parseDays), so it is safe in the text
 * @returns {Record<string, string>}
 */
export function queriesFor(days) {
  const where = `timestamp > NOW() - INTERVAL '${days}' DAY`;
  const step = days <= 2 ? 'HOUR' : 'DAY';
  const list = (columns, filter = '') => {
    const names = Object.keys(columns);
    const select = names.map((name) => `${columns[name]} AS ${name}`).join(', ');
    return (
      `SELECT ${select}, SUM(_sample_interval) AS views FROM ${DATASET} ` +
      `WHERE ${where}${filter} GROUP BY ${names.join(', ')} ORDER BY views DESC LIMIT ${LIST_LIMIT} FORMAT JSON`
    );
  };
  return {
    series:
      `SELECT toStartOfInterval(timestamp, INTERVAL '1' ${step}) AS t, SUM(_sample_interval) AS views ` +
      `FROM ${DATASET} WHERE ${where} GROUP BY t ORDER BY t FORMAT JSON`,
    routes: list({ path: 'blob1' }),
    countries: list({ country: 'blob2' }),
    regions: list({ region: 'blob3', country: 'blob2' }),
    cities: list({ city: 'blob4', region: 'blob3', country: 'blob2' }),
    devices: list({ device: 'blob6' }),
    browsers: list({ browser: 'blob7' }),
    os: list({ os: 'blob8' }),
    referrers: list({ referrer: 'blob9' }),
    languages: list({ language: 'blob10' }),
    statuses: list({ status: 'blob5' }),
    notFound: list({ path: 'blob1' }, ` AND blob5 = '404'`),
  };
}

/**
 * Runs one query. Counts come back as text (UInt64), so `views` becomes a number.
 *
 * @param {Record<string, any>} env
 * @param {string} sql
 * @param {typeof fetch} fetchFn
 * @returns {Promise<Record<string, string | number>[]>}
 */
export async function runQuery(env, sql, fetchFn = fetch) {
  // A secret pasted on Windows can end in a line break or a space; the API then refuses it (error 9106).
  const account = String(env.CF_ACCOUNT_ID).trim();
  const token = String(env.CF_API_TOKEN).trim();
  const response = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: sql,
  });
  if (!response.ok) throw new Error(`SQL API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const { data = [] } = await response.json();
  return data.map((row) => ({ ...row, views: Number(row.views) || 0 }));
}

/**
 * GET /admin: the page. GET /admin/api?days=7: the report as JSON (401 without the key).
 *
 * @param {Request} request
 * @param {Record<string, any>} env
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Response>}
 */
export async function handleAdmin(request, env, fetchFn = fetch) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return new Response(ADMIN_PAGE, {
      headers: {
        ...NO_INDEX,
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      },
    });
  }
  if (url.pathname !== '/admin/api') return json({ error: 'Not found' }, 404);
  if (!(await keyMatches(request.headers.get('authorization'), env.ADMIN_KEY))) {
    return json({ error: 'Wrong key' }, 401, { 'www-authenticate': 'Bearer' });
  }
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return json({ error: 'CF_ACCOUNT_ID or CF_API_TOKEN is not set' }, 500);
  const days = parseDays(url.searchParams.get('days'));
  const queries = Object.entries(queriesFor(days));
  try {
    const results = await Promise.all(queries.map(([, sql]) => runQuery(env, sql, fetchFn)));
    const report = Object.fromEntries(queries.map(([name], i) => [name, results[i]]));
    const total = report.series.reduce((sum, row) => sum + row.views, 0);
    return json({ days, step: days <= 2 ? 'hour' : 'day', total, ...report });
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 502);
  }
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_INDEX, ...headers, 'content-type': 'application/json; charset=utf-8' },
  });
}
