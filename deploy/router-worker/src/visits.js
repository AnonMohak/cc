/**
 * Visit counter: one Analytics Engine data point (binding VISITS, dataset
 * momo_visits) for each page load on the domain. The /admin page queries it.
 * Nothing that names a person is saved: no IP address, no full user-agent,
 * no cookie. The blob order is fixed, because the admin queries read
 * blob1 to blob10 by position.
 */

/** Analytics Engine limit for one index, in bytes. */
export const INDEX_MAX_BYTES = 96;

/** Paths that are never counted (the admin page itself). */
const NOT_COUNTED = /^\/admin(\/|$)/;

/**
 * True for a page load: a GET answered with HTML that is not a redirect.
 * Files (scripts, images), API calls (JSON) and redirects are left out.
 *
 * @param {Request} request
 * @param {Response} response
 */
export function isPageLoad(request, response) {
  if (request.method !== 'GET') return false;
  if (response.status >= 300 && response.status < 400) return false;
  if (NOT_COUNTED.test(new URL(request.url).pathname)) return false;
  return (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');
}

/**
 * 'mobile', 'tablet', 'desktop' or 'unknown' (no user-agent).
 * iPadOS asks for desktop pages with a Mac user-agent, so it counts as desktop.
 *
 * @param {string} ua
 */
export function deviceOf(ua) {
  if (!ua) return 'unknown';
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * The browser family. The order matters: Edge, Opera and Samsung Internet
 * also say Chrome and Safari, and Chrome also says Safari.
 *
 * @param {string} ua
 */
export function browserOf(ua) {
  if (!ua) return 'unknown';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'other';
}

/**
 * The operating system family. iOS and Android come before macOS and Linux,
 * because their user-agents also name those.
 *
 * @param {string} ua
 */
export function osOf(ua) {
  if (!ua) return 'unknown';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'other';
}

/**
 * The host of the Referer header without `www.`; '' when there is none.
 *
 * @param {string | null} referer
 */
export function referrerOf(referer) {
  if (!referer) return '';
  try {
    return new URL(referer).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The first language tag of Accept-Language, in lower case ('' when there is none).
 *
 * @param {string | null} header
 */
export function languageOf(header) {
  const tag = (header ?? '').split(',')[0].split(';')[0].trim().toLowerCase();
  return tag === '*' ? '' : tag.slice(0, 35);
}

/**
 * The text cut to at most `max` UTF-8 bytes, never inside a character.
 *
 * @param {string} text
 * @param {number} max
 */
export function cutBytes(text, max) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= max) return text;
  let out = '';
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > max) break;
    out += char;
    bytes += size;
  }
  return out;
}

/**
 * The data point for one page load.
 * blobs: path, country, region, city, status, device, browser, os, referrer, language.
 *
 * @param {Request} request
 * @param {Response} response
 * @returns {{ indexes: string[], blobs: string[], doubles: number[] }}
 */
export function visitOf(request, response) {
  const path = new URL(request.url).pathname;
  const cf = /** @type {Record<string, unknown>} */ (request.cf ?? {});
  const text = (value) => (typeof value === 'string' ? value : '');
  const ua = request.headers.get('user-agent') ?? '';
  return {
    indexes: [cutBytes(path, INDEX_MAX_BYTES)],
    blobs: [
      cutBytes(path, 1024),
      text(cf.country),
      text(cf.region),
      text(cf.city),
      String(response.status),
      deviceOf(ua),
      browserOf(ua),
      osOf(ua),
      referrerOf(request.headers.get('referer')),
      languageOf(request.headers.get('accept-language')),
    ],
    doubles: [1],
  };
}

/**
 * Writes the data point for a page load. A missing binding or a failed write
 * (for example over the daily limit) never breaks the page.
 *
 * @param {{ VISITS?: { writeDataPoint(point: object): void } }} env
 * @param {Request} request
 * @param {Response} response
 */
export function countVisit(env, request, response) {
  try {
    if (env.VISITS && isPageLoad(request, response)) env.VISITS.writeDataPoint(visitOf(request, response));
  } catch {
    // Counting is best effort.
  }
}
