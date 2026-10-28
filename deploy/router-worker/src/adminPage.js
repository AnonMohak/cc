/**
 * The /admin page (src/admin.js serves it): asks for the key, keeps it in
 * sessionStorage and draws the report from /admin/api. Same look as the main
 * site (dark, system font). No outside files: the CSP allows only this page.
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0b0b0c">
<title>momo visits</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0b0b0c;
  --fg: #ece9e2;
  --muted: #ece9e28c;
  --line: #ece9e247;
  --faint: #ece9e214;
  --bar: #ece9e2c0;
  --bad: #f2a08f;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  padding: 24px 16px 48px;
  max-width: 1120px;
  margin: 0 auto;
}
h1 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: 0.01em; }
h2 { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
button, input { font: inherit; color: inherit; }
button {
  background: transparent; border: 1px solid var(--line); border-radius: 999px;
  padding: 4px 12px; cursor: pointer;
}
button:hover { border-color: var(--fg); }
button[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
button:focus-visible, input:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; }
header { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.ranges { display: flex; gap: 6px; flex-wrap: wrap; }
.muted { color: var(--muted); }
.error { color: var(--bad); }
[hidden] { display: none !important; }

#login { max-width: 360px; margin: 18vh auto 0; display: grid; gap: 12px; }
#login input {
  background: transparent; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; width: 100%;
}

.hero { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.hero strong { font-size: 44px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1; }

.chart { position: relative; margin: 12px 0 36px; }
.chart svg { display: block; width: 100%; height: 220px; overflow: visible; }
.chart .grid line { stroke: var(--faint); }
.chart .grid text, .chart .axis text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.chart .bar { fill: var(--bar); }
.chart .hit { fill: transparent; }
.chart .hit:hover + .bar, .chart .bar.on { fill: var(--fg); }
.tip {
  position: absolute; pointer-events: none; background: var(--bg); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 9px; font-size: 13px; white-space: nowrap; transform: translate(-50%, -100%);
}
.tip b { font-variant-numeric: tabular-nums; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 28px 32px; }
.card { min-width: 0; }
.card table { width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed; }
.card td { padding: 4px 0; vertical-align: top; }
.card td.n { width: 5.5em; text-align: right; padding-left: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.card .label { overflow-wrap: anywhere; }
.card .track { height: 3px; margin-top: 3px; border-radius: 2px; background: var(--faint); }
.card .fill { height: 100%; border-radius: 2px; background: var(--bar); }
.card .none { color: var(--muted); font-size: 14px; }
@media (max-width: 400px) {
  .cards { grid-template-columns: 1fr; }
  .hero strong { font-size: 36px; }
}
</style>
</head>
<body>
<form id="login" hidden>
  <h1>momo visits</h1>
  <label for="key" class="muted">Admin key</label>
  <input id="key" type="password" autocomplete="current-password" required>
  <button type="submit">Open</button>
  <p id="loginError" class="error" role="alert"></p>
</form>

<main id="report" hidden>
  <header>
    <h1>momo visits</h1>
    <div class="ranges" role="group" aria-label="Time range">
      <button type="button" data-days="1">24 hours</button>
      <button type="button" data-days="7">7 days</button>
      <button type="button" data-days="30">30 days</button>
      <button type="button" data-days="90">90 days</button>
      <button type="button" id="signOut">Sign out</button>
    </div>
  </header>
  <p id="status" class="muted" role="status"></p>
  <section id="content" hidden>
    <div class="hero"><strong id="total">0</strong><span id="totalLabel" class="muted">page views</span></div>
    <div class="chart" id="chart"></div>
    <div class="cards" id="cards"></div>
  </section>
</main>

<script>
(function () {
  var KEY = 'momo-admin-key';
  var DAYS = 'momo-admin-days';
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  var memoryKey = null;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = new Intl.NumberFormat();
  var SVG = 'http://www.w3.org/2000/svg';

  var CARDS = [
    ['routes', 'Pages', ['path']],
    ['notFound', 'Not found (404)', ['path']],
    ['countries', 'Countries', ['country']],
    ['regions', 'Regions', ['region', 'country']],
    ['cities', 'Cities', ['city', 'region', 'country']],
    ['devices', 'Devices', ['device']],
    ['browsers', 'Browsers', ['browser']],
    ['os', 'Operating systems', ['os']],
    ['referrers', 'Referring sites', ['referrer']],
    ['languages', 'Languages', ['language']],
    ['statuses', 'Status codes', ['status']]
  ];
  var EMPTY = { referrer: 'none (direct)', language: 'not sent' };

  function key() { return memoryKey || store.get(KEY); }

  function showLogin(message) {
    $('report').hidden = true;
    $('login').hidden = false;
    $('loginError').textContent = message || '';
    $('key').focus();
  }

  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    memoryKey = $('key').value.trim();
    store.set(KEY, memoryKey);
    $('key').value = '';
    load(Number(store.get(DAYS)) || 7);
  });

  $('signOut').addEventListener('click', function () {
    memoryKey = null;
    lastReport = null;
    $('content').hidden = true;
    store.del(KEY);
    showLogin('');
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function (b) {
    b.addEventListener('click', function () { load(Number(b.dataset.days)); });
  });

  function load(days) {
    if (!key()) return showLogin('');
    store.set(DAYS, String(days));
    $('login').hidden = true;
    $('report').hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
    });
    $('status').className = 'muted';
    $('status').textContent = 'Loading...';
    fetch('/admin/api?days=' + days, { headers: { authorization: 'Bearer ' + key() }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) {
          memoryKey = null;
          store.del(KEY);
          showLogin('Wrong key.');
          return null;
        }
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
          return body;
        });
      })
      .then(function (report) { if (report) render(report); })
      .catch(function (err) {
        $('status').className = 'error';
        $('status').textContent = 'Could not load the report: ' + err.message;
      });
  }

  var lastReport = null;

  function render(r) {
    lastReport = r;
    $('status').textContent = 'Last ' + (r.days === 1 ? '24 hours' : r.days + ' days') + ', counted on the server.';
    $('content').hidden = false;
    $('total').textContent = fmt.format(r.total);
    $('totalLabel').textContent = r.total === 1 ? 'page view' : 'page views';
    drawChart(fillBuckets(r.series, r.days, r.step), r.step);
    var cards = $('cards');
    cards.textContent = '';
    CARDS.forEach(function (c) { cards.appendChild(card(c[1], r[c[0]] || [], c[2])); });
  }

  // The API returns only the hours or days that have visits; fill the rest with 0.
  function fillBuckets(rows, days, step) {
    var size = step === 'hour' ? 3600e3 : 86400e3;
    var byTime = {};
    rows.forEach(function (row) { byTime[Date.parse(String(row.t).replace(' ', 'T') + 'Z')] = row.views; });
    var end = Math.floor(Date.now() / size) * size;
    var start = end - Math.round(days * 86400e3 / size) * size + size;
    var out = [];
    for (var t = start; t <= end; t += size) out.push({ t: t, views: byTime[t] || 0 });
    return out;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * p >= v) return steps[i] * p;
    return 10 * p;
  }

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function label(t, step, long) {
    var d = new Date(t);
    if (step === 'hour') {
      return long
        ? d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
        : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
  }

  function drawChart(points, step) {
    var box = $('chart');
    box.textContent = '';
    var W = Math.max(box.clientWidth, 280), H = 220, top = 8, bottom = 24, left = 36;
    var max = niceMax(Math.max.apply(null, points.map(function (p) { return p.views; }).concat([1])));
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Page views for each ' + step }, box);
    var grid = el('g', { class: 'grid' }, svg);
    var plotH = H - top - bottom, plotW = W - left;
    for (var i = 0; i <= 4; i++) {
      var y = top + plotH - (plotH * i) / 4;
      el('line', { x1: left, x2: W, y1: y, y2: y }, grid);
      var tx = el('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, grid);
      tx.textContent = fmt.format((max * i) / 4);
    }
    var slot = plotW / points.length;
    var gap = slot > 6 ? 2 : 1;
    var barW = Math.max(slot - gap, 1);
    var axis = el('g', { class: 'axis' }, svg);
    var every = Math.ceil(points.length / Math.max(Math.floor(plotW / 70), 1));
    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    box.appendChild(tip);
    points.forEach(function (p, i) {
      var x = left + i * slot + gap / 2;
      var h = (p.views / max) * plotH;
      var hit = el('rect', { class: 'hit', x: left + i * slot, y: top, width: slot, height: plotH }, svg);
      if (h > 0) {
        var r = Math.min(4, barW / 2, h);
        // Rounded top, square base on the axis.
        el('path', {
          class: 'bar',
          d: 'M' + x + ',' + (top + plotH) + 'V' + (top + plotH - h + r) +
             'Q' + x + ',' + (top + plotH - h) + ' ' + (x + r) + ',' + (top + plotH - h) +
             'H' + (x + barW - r) + 'Q' + (x + barW) + ',' + (top + plotH - h) + ' ' + (x + barW) + ',' + (top + plotH - h + r) +
             'V' + (top + plotH) + 'Z'
        }, svg);
      } else {
        el('path', { class: 'bar', d: '' }, svg);
      }
      hit.addEventListener('mouseenter', function () {
        tip.hidden = false;
        tip.textContent = '';
        var b = document.createElement('b');
        b.textContent = fmt.format(p.views);
        tip.appendChild(b);
        tip.appendChild(document.createTextNode(' ' + (p.views === 1 ? 'view' : 'views') + ' \\u00b7 ' + label(p.t, step, true)));
        var px = ((left + i * slot + slot / 2) / W) * box.clientWidth;
        tip.style.left = Math.min(Math.max(px, 80), box.clientWidth - 80) + 'px';
        tip.style.top = ((top + plotH - h) / H) * 220 - 6 + 'px';
      });
      hit.addEventListener('mouseleave', function () { tip.hidden = true; });
      if (i % every === 0) {
        var t = el('text', { x: left + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle' }, axis);
        t.textContent = label(p.t, step, false);
      }
    });
  }

  function card(title, rows, fields) {
    var section = document.createElement('section');
    section.className = 'card';
    var h = document.createElement('h2');
    h.textContent = title;
    section.appendChild(h);
    if (!rows.length) {
      var p = document.createElement('p');
      p.className = 'none';
      p.textContent = 'No data yet.';
      section.appendChild(p);
      return section;
    }
    var max = rows[0].views || 1;
    var table = document.createElement('table');
    rows.forEach(function (row) {
      var tr = table.insertRow();
      var name = tr.insertCell();
      var text = fields.map(function (f) { return row[f]; }).filter(Boolean).join(', ');
      var span = document.createElement('div');
      span.className = 'label';
      span.textContent = text || EMPTY[fields[0]] || 'unknown';
      if (!text) span.classList.add('muted');
      var track = document.createElement('div');
      track.className = 'track';
      var fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = Math.max((row.views / max) * 100, 1) + '%';
      track.appendChild(fill);
      name.appendChild(span);
      name.appendChild(track);
      var n = tr.insertCell();
      n.className = 'n';
      n.textContent = fmt.format(row.views);
    });
    section.appendChild(table);
    return section;
  }

  // Redraw the chart for the new width from the last report (no new queries).
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (lastReport && !$('report').hidden) render(lastReport); }, 200);
  });

  if (key()) load(Number(store.get(DAYS)) || 7);
  else showLogin('');
})();
</script>
</body>
</html>
`;
