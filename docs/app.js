// IPO GMP dashboard — reads the JSON produced by the scraper and renders it.
'use strict';

const THRESHOLD = 10;
let ALL = [];
let HISTORY = {};
let FILTER = 'all';

const $ = (sel) => document.querySelector(sel);

async function load() {
  try {
    const [ipoRes, histRes] = await Promise.all([
      fetch('data/ipos.json?_=' + Date.now()),
      fetch('data/history.json?_=' + Date.now()),
    ]);
    const ipoDoc = await ipoRes.json();
    HISTORY = (await histRes.json().catch(() => ({ ipos: {} }))).ipos || {};
    ALL = ipoDoc.ipos || [];
    const when = new Date(ipoDoc.generatedAt);
    $('#meta').textContent =
      `${ALL.length} IPOs · updated ` +
      when.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) +
      ' IST';
    render();
  } catch (e) {
    $('#meta').textContent = 'Failed to load data.';
    $('#list').innerHTML = `<div class="empty">Could not load data.json.<br>${e}</div>`;
  }
}

function matches(ipo) {
  switch (FILTER) {
    case 'open':
      return ipo.status === 'Open' || ipo.status === 'Closing Today';
    case 'hot':
      return ipo.gmpPercent !== null && ipo.gmpPercent > THRESHOLD;
    case 'mainboard':
      return ipo.category === 'Mainboard';
    case 'sme':
      return ipo.category === 'SME';
    case 'upcoming':
      return ipo.status === 'Upcoming';
    case 'closed':
      return ipo.status === 'Closed' || ipo.status === 'Listed';
    default:
      return true;
  }
}

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function pctClass(p) {
  if (p === null) return 'zero';
  if (p > 0) return 'pos';
  if (p < 0) return 'neg';
  return 'zero';
}

// Minimal inline SVG sparkline from a numeric series.
function sparkline(series, w = 90, h = 28) {
  const pts = series.map((s) => s.gmpPercent);
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  const coords = pts.map((p, i) => {
    const x = i * step;
    const y = h - ((p - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = pts[pts.length - 1] >= pts[0];
  const color = up ? 'var(--green)' : 'var(--red)';
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline fill="none" stroke="${color}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" points="${coords.join(' ')}"/>
  </svg>`;
}

function card(ipo) {
  const hist = HISTORY[ipo.id];
  const spark = hist ? sparkline(hist.series || []) : '';
  const hot = ipo.gmpPercent !== null && ipo.gmpPercent > THRESHOLD;
  const statusCls = 'status-' + ipo.status.replace(/\s+/g, '');
  const pct = ipo.gmpPercent === null ? '—' : ipo.gmpPercent.toFixed(2) + '%';
  const val = ipo.gmp === null ? 'No GMP' : '₹' + ipo.gmp;
  return `
  <article class="ipo ${hot ? 'hot' : ''}" data-id="${ipo.id}">
    <div class="ipo-top">
      <div>
        <div class="ipo-name">${ipo.name}</div>
        <div class="badges">
          <span class="badge cat">${ipo.category}</span>
          <span class="badge ${statusCls}">${ipo.status}</span>
          ${ipo.exchange ? `<span class="badge">${ipo.exchange}</span>` : ''}
        </div>
      </div>
      <div class="gmp">
        <div class="gmp-pct ${pctClass(ipo.gmpPercent)}">${pct}</div>
        <div class="gmp-val">${val}</div>
      </div>
    </div>
    <div class="ipo-bottom">
      <div class="dates">
        ${ipo.open ? 'Open ' + fmt(ipo.open) : ''}
        ${ipo.close ? ' · Close ' + fmt(ipo.close) : ''}
        ${ipo.price ? ' · ₹' + ipo.price : ''}
      </div>
      ${spark}
    </div>
  </article>`;
}

function render() {
  const rows = ALL.filter(matches);
  const list = $('#list');
  if (rows.length === 0) {
    list.innerHTML = '<div class="empty">No IPOs match this filter.</div>';
    return;
  }
  list.innerHTML = rows.map(card).join('');
  list.querySelectorAll('.ipo').forEach((el) => {
    el.addEventListener('click', () => openModal(el.dataset.id));
  });
}

function openModal(id) {
  const ipo = ALL.find((i) => i.id === id);
  const hist = HISTORY[id];
  if (!ipo) return;
  $('#modalTitle').textContent = ipo.name;
  $('#modalMeta').textContent =
    `${ipo.category} · ${ipo.status}` +
    (ipo.close ? ` · closes ${fmt(ipo.close)}` : '') +
    (ipo.price ? ` · ₹${ipo.price}` : '');

  const series = (hist && hist.series) || [];
  $('#chart').innerHTML = series.length
    ? sparkline(series, 520, 120)
    : '<p class="meta">No history recorded yet.</p>';

  $('#historyList').innerHTML = series
    .slice()
    .reverse()
    .map((s) => {
      const t = new Date(s.t);
      const when = t.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const cls = pctClass(s.gmpPercent);
      return `<div class="history-row"><span>${when}</span>
        <span><b class="gmp-pct ${cls}" style="font-size:13px">${s.gmpPercent.toFixed(
        2
      )}%</b> · ₹${s.gmp ?? '--'}</span></div>`;
    })
    .join('');

  $('#modal').hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
}

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  FILTER = btn.dataset.filter;
  render();
});

$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

load();
// Auto-refresh every 10 minutes while the tab is open.
setInterval(load, 10 * 60 * 1000);
