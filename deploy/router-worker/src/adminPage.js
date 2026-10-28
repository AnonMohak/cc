/**
 * The /admin page (src/admin.js serves it): asks for the key, keeps it in
 * sessionStorage and draws the report from /admin/api (summary) or
 * /admin/api/visits (table). The look is the dakken landing page's stats page
 * (dakken-landing-page: stats/index.html, src/style.css) in its tokyo-night
 * theme (src/themes.js). Only the font comes from outside (Google Fonts).
 */
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1a1b26">
<title>momo visits</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap">
<style>
/* tokyo-night, as in dakken's themes.js */
:root {
  color-scheme: dark;
  --t-bg: #1a1b26;
  --t-sub: #565f89;
  --t-text: #c0caf5;
  --t-accent: #7aa2f7;
  --t-error: #f7768e;
  /* sub is under 3:1: muted is for text people must read */
  --muted: color-mix(in srgb, var(--t-text) 60%, var(--t-sub));
  --line: color-mix(in srgb, var(--t-sub) 22%, transparent);
  --track: color-mix(in srgb, var(--t-sub) 25%, transparent);
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html { background: var(--t-bg); }
body {
  margin: 0; background: var(--t-bg); color: var(--t-text);
  font: 400 15px/1.5 var(--mono); -webkit-font-smoothing: antialiased; cursor: default;
  /* Paths must show as they are: no ligatures (JetBrains Mono joins "/=" and "->") */
  font-variant-ligatures: none;
}
::selection { background: color-mix(in srgb, var(--t-accent) 30%, transparent); }
main { max-width: 64rem; margin: 0 auto; padding: 0 16px 32px; min-height: 100svh; display: flex; flex-direction: column; }
@media (min-width: 640px) { main { padding: 0 32px 32px; } }
h1 { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; }
@media (min-width: 640px) { h1 { font-size: 1.875rem; } }
h2 { margin: 3.5rem 0 0; font-size: 0.875rem; font-weight: 400; color: var(--muted); }
p { margin: 0; }
button, input { font: inherit; color: inherit; }
button { background: none; border: 0; padding: 0; cursor: pointer; }
input { cursor: text; }
:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 3px; border-radius: 2px; }
[hidden] { display: none !important; }
.muted { color: var(--muted); }
.accent { color: var(--t-accent); }
.error { color: var(--t-error); }
.small { font-size: 0.875rem; }
.xs { font-size: 0.75rem; }
.num { font-variant-numeric: tabular-nums; }

header { padding-top: 2.5rem; }
@media (min-width: 640px) { header { padding-top: 3.5rem; } }
header p { margin-top: 0.25rem; }

/* Text buttons, like dakken's nav: the chosen one in the accent */
.controls { margin-top: 2rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1.75rem; font-size: 0.875rem; }
.group { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; }
.pick { color: var(--muted); }
.pick:hover { color: var(--t-text); }
.pick[aria-pressed="true"] { color: var(--t-accent); }

.dashed {
  border: 0; border-bottom: 1px dashed color-mix(in srgb, var(--t-sub) 60%, transparent);
  background: transparent; padding: 0 0 0.25rem; color: var(--t-text); border-radius: 0;
}
.dashed::placeholder { color: var(--t-sub); }
.link { color: var(--t-accent); }
.link:hover { color: var(--t-text); }

#login { margin-top: 2.5rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem; font-size: 0.875rem; }
#login input { flex: 1; min-width: 0; }
#login .error { flex-basis: 100%; }

#status { margin-top: 2.5rem; font-size: 0.875rem; }

.numbers { margin: 2.5rem 0 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem 1rem; }
@media (min-width: 640px) { .numbers { grid-template-columns: repeat(4, 1fr); } }
.numbers dt { font-size: 0.875rem; color: var(--muted); }
.numbers dd { margin: 0.25rem 0 0; font-size: 1.875rem; line-height: 2.25rem; font-variant-numeric: tabular-nums; }

/* Bar chart: accent bars, the largest value above, first and last dates below */
.chart { position: relative; margin-top: 1rem; }
.chart svg { display: block; width: 100%; height: 8rem; }
.chart .tip { position: absolute; right: 0; top: 0; pointer-events: none; }
.chart .ends { margin-top: 0.25rem; display: flex; justify-content: space-between; }
.chart .day:hover path { fill: var(--t-text); }

.lists { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(19rem, 100%), 1fr)); column-gap: 3rem; }
.lists > section { min-width: 0; }

/* Plain lines, like a terminal table (dakken's .board) */
.board { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin-top: 0.5rem; }
.board th { padding: 0.4rem 0.75rem 0.4rem 0; color: var(--t-sub); font-weight: 400; text-align: left; white-space: nowrap; }
.board td { padding: 0.45rem 0.75rem 0.45rem 0; border-top: 1px solid var(--line); vertical-align: top; }
.board th:last-child, .board td:last-child { padding-right: 0; }
.board .right { text-align: right; }
.board.ranked { table-layout: fixed; }
.board.ranked td.n { width: 5.5rem; text-align: right; font-variant-numeric: tabular-nums; }
.board .label { overflow-wrap: anywhere; }
.board .track { height: 2px; margin-top: 0.3rem; background: var(--track); }
.board .fill { height: 100%; background: var(--t-accent); }
.board .none { color: var(--muted); }

.toolbar { margin-top: 2.5rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem 1.5rem; font-size: 0.875rem; }
.toolbar input { width: min(20rem, 100%); }
/* Wide table: it scrolls sideways inside its own box, never the page */
.scroll { margin-top: 0.5rem; overflow-x: auto; }
.visits { white-space: nowrap; }
.visits td.path { white-space: normal; overflow-wrap: anywhere; min-width: 14rem; max-width: 24rem; }
.visits td.n { color: var(--t-sub); text-align: right; font-variant-numeric: tabular-nums; }
.visits td.bad { color: var(--t-error); }

footer { margin-top: auto; padding-top: 6rem; font-size: 0.875rem; }
</style>
</head>
<body>
<main>
  <header>
    <h1>visits</h1>
    <p class="muted">private · page loads on me-momo.co.in, counted on the server</p>
  </header>

  <form id="login" hidden>
    <label for="key" class="muted">admin key</label>
    <input id="key" class="dashed" type="password" autocomplete="current-password" required>
    <button class="link" type="submit">open</button>
    <p id="loginError" class="error" role="alert"></p>
  </form>

  <div id="report" hidden>
    <div class="controls">
      <div class="group" role="group" aria-label="time range">
        <button type="button" class="pick" data-days="1">24 hours</button>
        <button type="button" class="pick" data-days="7">7 days</button>
        <button type="button" class="pick" data-days="30">30 days</button>
        <button type="button" class="pick" data-days="90">90 days</button>
      </div>
      <div class="group" role="group" aria-label="view">
        <button type="button" class="pick" data-view="summary">summary</button>
        <button type="button" class="pick" data-view="table">table</button>
      </div>
    </div>
    <p id="status" class="muted" role="status"></p>

    <section id="content" hidden>
      <dl class="numbers">
        <div><dt>page views</dt><dd id="total" class="accent"></dd></div>
        <div><dt>pages</dt><dd id="pageCount"></dd></div>
        <div><dt>countries</dt><dd id="countryCount"></dd></div>
        <div><dt>not found · 404</dt><dd id="notFoundCount"></dd></div>
      </dl>
      <h2 id="chartTitle">page views</h2>
      <div class="chart" id="chart"></div>
      <div class="lists" id="lists"></div>
    </section>

    <section id="tableView" hidden>
      <div class="toolbar">
        <input id="filter" class="dashed" type="search" placeholder="filter, any column" aria-label="filter the rows">
        <span id="rowCount" class="muted num"></span>
        <button type="button" id="csv" class="link">download csv</button>
      </div>
      <div class="scroll"><table class="board visits" id="visits"></table></div>
    </section>
  </div>

  <footer id="footer" class="muted" hidden>
    <button type="button" id="signOut" class="link">forget the key</button> on this device.
  </footer>
</main>

<script>
(function () {
  var KEY = 'momo-admin-key';
  var DAYS = 'momo-admin-days';
  var VIEW = 'momo-admin-view';
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };
  var memoryKey = null;
  var lastReport = null;
  var lastVisits = null;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = new Intl.NumberFormat();
  var SVG = 'http://www.w3.org/2000/svg';
  var each = function (selector, fn) { Array.prototype.forEach.call(document.querySelectorAll(selector), fn); };

  var LISTS = [
    ['routes', 'pages', ['path']],
    ['notFound', 'not found · 404', ['path']],
    ['countries', 'countries', ['country']],
    ['regions', 'regions', ['region', 'country']],
    ['cities', 'cities', ['city', 'region', 'country']],
    ['devices', 'devices', ['device']],
    ['browsers', 'browsers', ['browser']],
    ['os', 'operating systems', ['os']],
    ['referrers', 'referring sites', ['referrer']],
    ['languages', 'languages', ['language']],
    ['statuses', 'status codes', ['status']]
  ];
  var EMPTY = { referrer: 'none (direct)', language: 'not sent' };

  function key() { return memoryKey || store.get(KEY); }
  function days() { return Number(store.get(DAYS)) || 7; }
  function view() { return store.get(VIEW) === 'table' ? 'table' : 'summary'; }
  function rangeText(d) { return 'last ' + (d === 1 ? '24 hours' : d + ' days'); }
  function utc(t) { return new Date(Date.parse(String(t).replace(' ', 'T') + 'Z')); }

  function showLogin(message) {
    $('report').hidden = true;
    $('footer').hidden = true;
    $('login').hidden = false;
    $('loginError').textContent = message || '';
    $('key').focus();
  }

  $('login').addEventListener('submit', function (e) {
    e.preventDefault();
    memoryKey = $('key').value.trim();
    store.set(KEY, memoryKey);
    $('key').value = '';
    load(days());
  });

  $('signOut').addEventListener('click', function () {
    memoryKey = null;
    lastReport = null;
    lastVisits = null;
    $('content').hidden = true;
    $('tableView').hidden = true;
    store.del(KEY);
    showLogin('');
  });

  each('[data-days]', function (b) {
    b.addEventListener('click', function () { load(Number(b.dataset.days)); });
  });
  each('[data-view]', function (b) {
    b.addEventListener('click', function () {
      store.set(VIEW, b.dataset.view);
      load(days());
    });
  });

  function load(d) {
    if (!key()) return showLogin('');
    store.set(DAYS, String(d));
    var v = view();
    $('login').hidden = true;
    $('report').hidden = false;
    $('footer').hidden = false;
    $('content').hidden = v !== 'summary' || !lastReport;
    $('tableView').hidden = v !== 'table' || !lastVisits;
    each('[data-days]', function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.days) === d)); });
    each('[data-view]', function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === v)); });
    $('status').className = 'muted';
    $('status').textContent = 'loading...';
    var url = (v === 'table' ? '/admin/api/visits' : '/admin/api') + '?days=' + d;
    fetch(url, { headers: { authorization: 'Bearer ' + key() }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 401) {
          memoryKey = null;
          store.del(KEY);
          showLogin('wrong key');
          return null;
        }
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
          return body;
        });
      })
      .then(function (report) {
        if (!report || view() !== v) return;
        if (v === 'table') renderTable(report);
        else render(report);
      })
      .catch(function (err) {
        $('status').className = 'error';
        $('status').textContent = 'could not load the report: ' + err.message;
      });
  }

  // ----- summary -----

  function sum(rows) { return rows.reduce(function (s, r) { return s + r.views; }, 0); }

  function render(r) {
    lastReport = r;
    $('status').textContent = rangeText(r.days) + ' · times in your time zone';
    $('tableView').hidden = true;
    $('content').hidden = false;
    $('total').textContent = fmt.format(r.total);
    // The lists stop at 25 rows, so a full list shows as "25+".
    var count = function (rows) { return rows.length >= 25 ? '25+' : String(rows.length); };
    $('pageCount').textContent = count(r.routes);
    $('countryCount').textContent = count(r.countries.filter(function (c) { return c.country; }));
    $('notFoundCount').textContent = fmt.format(sum(r.statuses.filter(function (s) { return s.status === '404'; })));
    $('chartTitle').textContent = 'page views each ' + r.step;
    drawChart(fillBuckets(r.series, r.days, r.step), r.step);
    var lists = $('lists');
    lists.textContent = '';
    LISTS.forEach(function (l) { lists.appendChild(list(l[1], r[l[0]] || [], l[2])); });
  }

  // The API returns only the hours or days that have visits; fill the rest with 0.
  function fillBuckets(rows, d, step) {
    var size = step === 'hour' ? 3600e3 : 86400e3;
    var byTime = {};
    rows.forEach(function (row) { byTime[utc(row.t).getTime()] = row.views; });
    var end = Math.floor(Date.now() / size) * size;
    var start = end - Math.round(d * 86400e3 / size) * size + size;
    var out = [];
    for (var t = start; t <= end; t += size) out.push({ t: t, views: byTime[t] || 0 });
    return out;
  }

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function when(t, step) {
    var d = new Date(t);
    return step === 'hour'
      ? d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // A bar for each hour or day, in the accent; an empty one has no bar. The
  // value of a bar shows at the top right on hover (and in its title).
  function drawChart(points, step) {
    var box = $('chart');
    box.textContent = '';
    var most = Math.max.apply(null, points.map(function (p) { return p.views; }).concat([1]));
    var top = document.createElement('p');
    top.className = 'xs muted num';
    top.textContent = fmt.format(most);
    box.appendChild(top);
    var W = Math.max(box.clientWidth, 200), H = 128;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'page views each ' + step }, box);
    el('line', { x1: 0, y1: H - 0.5, x2: W, y2: H - 0.5, stroke: 'var(--t-sub)', 'stroke-opacity': 0.5 }, svg);
    var slot = W / points.length;
    var gap = slot > 8 ? 3 : 1;
    var barW = Math.max(slot - gap, 1);
    var tip = document.createElement('p');
    tip.className = 'tip xs num';
    tip.hidden = true;
    points.forEach(function (p, i) {
      var label = when(p.t, step) + ': ' + fmt.format(p.views) + (p.views === 1 ? ' view' : ' views');
      var g = el('g', { class: 'day' }, svg);
      var hit = el('rect', { x: i * slot, y: 0, width: slot, height: H, fill: 'transparent' }, g);
      el('title', {}, hit).textContent = label;
      if (p.views) {
        var h = Math.max((p.views / most) * (H - 4), 2);
        var x = i * slot + gap / 2;
        var r = Math.min(4, barW / 2, h);
        el('path', {
          fill: 'var(--t-accent)',
          d: 'M' + x + ',' + H + 'V' + (H - h + r) + 'Q' + x + ',' + (H - h) + ' ' + (x + r) + ',' + (H - h) +
             'H' + (x + barW - r) + 'Q' + (x + barW) + ',' + (H - h) + ' ' + (x + barW) + ',' + (H - h + r) + 'V' + H + 'Z'
        }, g);
      }
      g.addEventListener('pointerenter', function () { tip.textContent = label; tip.hidden = false; });
      g.addEventListener('pointerleave', function () { tip.hidden = true; });
    });
    var ends = document.createElement('p');
    ends.className = 'ends xs muted num';
    [points[0], points[points.length - 1]].forEach(function (p) {
      var s = document.createElement('span');
      s.textContent = when(p.t, step);
      ends.appendChild(s);
    });
    box.appendChild(ends);
    box.appendChild(tip);
  }

  function list(title, rows, fields) {
    var section = document.createElement('section');
    var h = document.createElement('h2');
    h.textContent = title;
    section.appendChild(h);
    var table = document.createElement('table');
    table.className = 'board ranked';
    if (!rows.length) {
      table.insertRow().insertCell().textContent = 'nothing yet';
      table.rows[0].cells[0].className = 'none';
    }
    var max = rows.length ? rows[0].views || 1 : 1;
    rows.forEach(function (row) {
      var tr = table.insertRow();
      var name = tr.insertCell();
      var text = fields.map(function (f) { return row[f]; }).filter(Boolean).join(', ');
      var label = document.createElement('div');
      label.className = 'label' + (text ? '' : ' muted');
      label.textContent = text || EMPTY[fields[0]] || 'unknown';
      var track = document.createElement('div');
      track.className = 'track';
      var fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = Math.max((row.views / max) * 100, 1) + '%';
      track.appendChild(fill);
      name.appendChild(label);
      name.appendChild(track);
      var n = tr.insertCell();
      n.className = 'n';
      n.textContent = fmt.format(row.views);
    });
    section.appendChild(table);
    return section;
  }

  // ----- table: one row for each page load (no visitor ID, so not grouped by person) -----

  var COLUMNS = [
    ['#', function (v, i) { return String(i + 1); }],
    ['time', function (v) {
      return utc(v.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }],
    ['page', function (v) { return v.path; }],
    ['country', function (v) { return v.country; }],
    ['region / city', function (v) { return [v.region, v.city].filter(Boolean).join(' / '); }],
    ['device', function (v) { return v.device; }],
    ['browser', function (v) { return v.browser; }],
    ['os', function (v) { return v.os; }],
    ['referrer', function (v) { return v.referrer || 'direct'; }],
    ['language', function (v) { return v.language; }],
    ['status', function (v) { return v.status; }]
  ];
  var CLASSES = { '#': 'n', page: 'path' };

  function renderTable(report) {
    lastVisits = {
      rows: report.visits.map(function (v, i) {
        var cells = COLUMNS.map(function (c) { return c[1](v, i) || ''; });
        return { cells: cells, search: cells.join(' ').toLowerCase(), bad: v.status !== '200' };
      })
    };
    $('content').hidden = true;
    $('tableView').hidden = false;
    var sampled = report.visits.some(function (v) { return v.weight > 1; });
    $('status').textContent = rangeText(report.days) + ' · the newest ' + report.limit + ' page loads at most, newest first' +
      (sampled ? ' · some rows are samples and stand for more than one page load' : '');
    drawTable();
  }

  function shownRows() {
    var q = $('filter').value.trim().toLowerCase();
    return lastVisits.rows.filter(function (r) { return !q || r.search.indexOf(q) !== -1; });
  }

  function drawTable() {
    var rows = shownRows();
    var table = $('visits');
    table.textContent = '';
    var head = table.createTHead().insertRow();
    COLUMNS.forEach(function (c) {
      var th = document.createElement('th');
      th.textContent = c[0];
      th.scope = 'col';
      if (c[0] === '#') th.className = 'right';
      head.appendChild(th);
    });
    var body = table.createTBody();
    rows.forEach(function (r) {
      var tr = body.insertRow();
      r.cells.forEach(function (text, i) {
        var td = tr.insertCell();
        td.textContent = text;
        var name = COLUMNS[i][0];
        if (CLASSES[name]) td.className = CLASSES[name];
        if (name === 'status' && r.bad) td.className = 'bad';
      });
    });
    var all = lastVisits.rows.length;
    $('rowCount').textContent = (rows.length === all ? all : rows.length + ' of ' + all) + (all === 1 ? ' row' : ' rows');
  }

  $('filter').addEventListener('input', function () { if (lastVisits) drawTable(); });

  // A cell that starts with = + - @ is a formula in a spreadsheet; paths come from anyone, so it gets a leading '.
  function csvCell(text) {
    var safe = /^[=+\\-@\\t\\r]/.test(text) ? "'" + text : text;
    return /[",\\r\\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }

  $('csv').addEventListener('click', function () {
    if (!lastVisits) return;
    var lines = [COLUMNS.map(function (c) { return csvCell(c[0]); }).join(',')];
    shownRows().forEach(function (r) { lines.push(r.cells.map(csvCell).join(',')); });
    var blob = new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'momo-visits-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // Redraw the chart for the new width from the last report (no new queries).
  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (lastReport && view() === 'summary' && !$('report').hidden) render(lastReport);
    }, 200);
  });

  if (key()) load(days());
  else showLogin('');
})();
</script>
</body>
</html>
`;
