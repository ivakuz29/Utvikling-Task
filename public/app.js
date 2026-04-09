'use strict';

// ── Tiny safe DOM helper (textContent only — no innerHTML with user data) ─────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class')        node.className = v;
    else if (k === 'data')    Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else                      node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 4000) {
  const container = $('#toast-container');
  const t = el('div', { class: `toast toast-${type}` }, msg);
  container.append(t);
  setTimeout(() => t.remove(), duration);
}

// ── API fetch wrapper — never exposes raw errors to DOM ───────────────────────
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Request failed.');
  return json;
}

// ── State ─────────────────────────────────────────────────────────────────────
let allDeals    = [];
let filterCity  = '';
let filterCat   = '';
let filterSearch = '';

// ── Boot ──────────────────────────────────────────────────────────────────────
(async function init() {
  await Promise.all([
    loadStats(),
    loadFilters(),
    loadDeals(),
    loadProducts(),
  ]);
  wireWaitlistForm();
  wireTrackForm();
  wireModal();
})();

// ── Stats ─────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const s = await api('/products/stats');
    const container = $('#hero-stats');
    container.innerHTML = '';
    container.append(
      statCard(s.stores,      'Stores monitored'),
      statCard(s.products,    'Tracked products'),
      statCard(s.avgSavings + '%', 'Avg. featured saving'),
    );
  } catch {
    // silently leave skeleton
  }
}

function statCard(value, label) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat__value' }, String(value)),
    el('div', { class: 'stat__label' }, label),
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────
async function loadFilters() {
  try {
    const { categories, cities } = await api('/deals/filters');
    const citySelect = $('#filter-city');
    const catSelect  = $('#filter-category');

    for (const c of cities) {
      citySelect.append(el('option', { value: c }, c));
    }
    for (const c of categories) {
      catSelect.append(el('option', { value: c }, c));
    }

    citySelect.addEventListener('change', e => { filterCity = e.target.value; renderDeals(); });
    catSelect.addEventListener('change',  e => { filterCat  = e.target.value; renderDeals(); });

    $('#filter-search').addEventListener('input', e => {
      filterSearch = e.target.value.toLowerCase();
      renderDeals();
    });

    $('#btn-reset-filters').addEventListener('click', () => {
      filterCity = ''; filterCat = ''; filterSearch = '';
      citySelect.value = ''; catSelect.value = ''; $('#filter-search').value = '';
      renderDeals();
    });
  } catch { /* ignore */ }
}

// ── Deals ─────────────────────────────────────────────────────────────────────
async function loadDeals() {
  try {
    const { data } = await api('/deals?limit=50');
    allDeals = data;
    renderDeals();
    renderHeroFeed(data.slice(0, 3));
  } catch (err) {
    toast('Could not load deals: ' + err.message, 'error');
    $('#deals-grid').innerHTML = '';
  }
}

function renderDeals() {
  const grid  = $('#deals-grid');
  const empty = $('#deals-empty');
  grid.innerHTML = '';

  let deals = allDeals;

  if (filterCity)   deals = deals.filter(d => d.city === filterCity);
  if (filterCat)    deals = deals.filter(d => d.category === filterCat);
  if (filterSearch) deals = deals.filter(d =>
    d.product_name.toLowerCase().includes(filterSearch) ||
    d.store_name.toLowerCase().includes(filterSearch)   ||
    d.chain.toLowerCase().includes(filterSearch)
  );

  if (deals.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const deal of deals) {
    grid.append(dealCard(deal));
  }
}

function dealCard(d) {
  const discountStr = '\u2212' + d.discount_pct + '%';
  const timeAgo     = relativeTime(d.recorded_at);

  return el('article', {
    class: 'deal-entry',
    data:  { storeId: d.store_id, productId: d.product_id },
    onclick: () => openModal(d),
  },
    el('div', { class: 'deal-entry__product' },
      el('span', { class: 'deal-entry__name' }, d.product_name),
      el('span', { class: 'deal-entry__cat'  }, d.category || ''),
    ),
    el('div', { class: 'deal-entry__store' },
      el('span', { class: 'deal-entry__chain' }, d.chain),
      el('span', { class: 'deal-entry__city'  }, d.city),
    ),
    el('div', { class: 'deal-entry__drop' }, discountStr),
    el('div', { class: 'deal-entry__prices' },
      el('span', { class: 'deal-entry__new' }, formatKr(d.current_price)),
      el('span', { class: 'deal-entry__old' }, formatKr(d.previous_price)),
    ),
    el('div', { class: 'deal-entry__time' }, timeAgo),
    el('div', { class: 'deal-entry__action' },
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: (e) => { e.stopPropagation(); handleTrackClick(d); },
      }, 'Track'),
    ),
  );
}

// ── Hero feed ─────────────────────────────────────────────────────────────────
function renderHeroFeed(deals) {
  const feed = $('#hero-feed');
  feed.innerHTML = '';

  deals.forEach((d) => {
    feed.append(
      el('div', { class: 'feed-item' },
        el('div', { class: 'feed-item__info' },
          el('span', { class: 'feed-item__name'  }, d.product_name),
          el('span', { class: 'feed-item__store' }, d.chain + ' \u00b7 ' + d.city),
        ),
        el('div', { class: 'feed-item__prices' },
          el('span', { class: 'feed-item__new'  }, formatKr(d.current_price)),
          el('span', { class: 'feed-item__old'  }, formatKr(d.previous_price)),
          el('span', { class: 'feed-item__drop' }, '\u2212' + d.discount_pct + '%'),
        ),
      )
    );
  });
}

// ── Products for the track form ───────────────────────────────────────────────
async function loadProducts() {
  try {
    const { data } = await api('/products');
    const sel = $('#track-product');
    for (const p of data) {
      sel.append(el('option', { value: p.id }, p.name));
    }
  } catch { /* ignore */ }
}

// ── Waitlist form ─────────────────────────────────────────────────────────────
function wireWaitlistForm() {
  const form = $('#waitlist-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const name    = $('#wl-name').value.trim();
    const email   = $('#wl-email').value.trim();
    const city    = $('#wl-city').value;
    const items   = $('#wl-items').value.trim();
    const notify  = $('#wl-notify').checked;

    let valid = true;
    if (name.length < 2) { showError('err-name',  'Name must be at least 2 characters.'); valid = false; }
    if (!isValidEmail(email)) { showError('err-email', 'Enter a valid email address.'); valid = false; }
    if (!city) { showError('err-city', 'Please select your city.'); valid = false; }
    if (!valid) return;

    const btn = $('#btn-waitlist');
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      await api('/users/waitlist', {
        method: 'POST',
        body: JSON.stringify({ name, email, city, items_text: items, notifications_enabled: notify }),
      });
      toast('You\'re on the list! We\'ll alert you when deals drop near you.', 'success', 6000);
      form.reset();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Get notified';
    }
  });
}

// ── Track form ────────────────────────────────────────────────────────────────
function wireTrackForm() {
  const form = $('#track-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email     = $('#track-email').value.trim();
    const productId = $('#track-product').value;
    const dist      = parseFloat($('#track-distance').value) || 5;

    if (!isValidEmail(email)) { toast('Enter a valid email address.', 'error'); return; }
    if (!productId)            { toast('Please select a product to track.', 'error'); return; }

    try {
      await api('/users/track', {
        method: 'POST',
        body: JSON.stringify({ email, product_id: productId, max_distance_km: dist }),
      });
      toast('Product is now being tracked!', 'success');
      form.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function handleTrackClick(deal) {
  // Scroll to track form and pre-select product
  document.getElementById('signup').scrollIntoView({ behavior: 'smooth' });

  // Pre-select the product in the track form
  const sel = $('#track-product');
  for (const opt of sel.options) {
    if (opt.text.includes(deal.product_name)) {
      sel.value = opt.value;
      break;
    }
  }
}

// ── Price history modal ───────────────────────────────────────────────────────
function wireModal() {
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target === $('#modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

async function openModal(deal) {
  const overlay = $('#modal-overlay');
  $('#modal-title').textContent    = deal.product_name;
  $('#modal-subtitle').textContent = deal.chain + ' · ' + deal.address + ' · ' + deal.city;
  $('#modal-history-list').innerHTML = '';

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  try {
    const { data: history } = await api(
      `/deals/history?store_id=${encodeURIComponent(deal.store_id)}&product_id=${encodeURIComponent(deal.product_id)}`
    );
    renderChart(history);
    renderHistoryList(history);
  } catch {
    $('#modal-history-list').textContent = 'Could not load price history.';
  }
}

function closeModal() {
  $('#modal-overlay').hidden = true;
  document.body.style.overflow = '';
  clearChart();
}

function renderHistoryList(history) {
  const list = $('#modal-history-list');
  list.innerHTML = '';
  for (const entry of [...history].reverse()) {
    list.append(
      el('div', { class: 'history-row' },
        el('span', {}, formatDate(entry.recorded_at)),
        el('span', {}, formatKr(entry.price)),
      )
    );
  }
}

// ── Minimal canvas chart (no library dependency) ───────────────────────────────
let chartCanvas, chartCtx;

function renderChart(history) {
  if (!chartCanvas) {
    chartCanvas = $('#price-chart');
    chartCtx    = chartCanvas.getContext('2d');
  }

  const container = chartCanvas.parentElement;
  chartCanvas.width  = container.clientWidth  || 460;
  chartCanvas.height = container.clientHeight || 180;

  const W = chartCanvas.width;
  const H = chartCanvas.height;
  const pad = { top: 16, right: 16, bottom: 30, left: 48 };

  chartCtx.clearRect(0, 0, W, H);

  if (history.length < 2) {
    chartCtx.fillStyle = '#9C9C9C';
    chartCtx.font      = '14px "DM Sans", system-ui, sans-serif';
    chartCtx.fillText('Not enough data for a chart.', pad.left, H / 2);
    return;
  }

  const prices = history.map(h => h.price);
  const minP   = Math.min(...prices) * 0.9;
  const maxP   = Math.max(...prices) * 1.05;
  const rangeP = maxP - minP || 1;

  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top  - pad.bottom;

  const xOf = i => pad.left + (i / (history.length - 1)) * innerW;
  const yOf = p => pad.top  + (1 - (p - minP) / rangeP)  * innerH;

  // Grid lines
  chartCtx.strokeStyle = 'rgba(0,0,0,0.07)';
  chartCtx.lineWidth   = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad.top + (g / 4) * innerH;
    chartCtx.beginPath();
    chartCtx.moveTo(pad.left, y);
    chartCtx.lineTo(W - pad.right, y);
    chartCtx.stroke();
  }

  // Fill gradient
  const grad = chartCtx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(26,92,56,0.18)');
  grad.addColorStop(1, 'rgba(26,92,56,0)');

  chartCtx.beginPath();
  chartCtx.moveTo(xOf(0), yOf(prices[0]));
  prices.forEach((p, i) => { if (i > 0) chartCtx.lineTo(xOf(i), yOf(p)); });
  chartCtx.lineTo(xOf(prices.length - 1), H - pad.bottom);
  chartCtx.lineTo(xOf(0), H - pad.bottom);
  chartCtx.closePath();
  chartCtx.fillStyle = grad;
  chartCtx.fill();

  // Line
  chartCtx.beginPath();
  chartCtx.strokeStyle = '#1A5C38';
  chartCtx.lineWidth   = 2;
  chartCtx.lineJoin    = 'round';
  prices.forEach((p, i) => {
    i === 0 ? chartCtx.moveTo(xOf(i), yOf(p)) : chartCtx.lineTo(xOf(i), yOf(p));
  });
  chartCtx.stroke();

  // Dots
  prices.forEach((p, i) => {
    chartCtx.beginPath();
    chartCtx.arc(xOf(i), yOf(p), 3.5, 0, Math.PI * 2);
    chartCtx.fillStyle   = '#1A5C38';
    chartCtx.strokeStyle = '#FFFFFF';
    chartCtx.lineWidth   = 2;
    chartCtx.fill();
    chartCtx.stroke();
  });

  // Y-axis labels
  chartCtx.fillStyle  = '#9C9C9C';
  chartCtx.font       = '11px "DM Sans", system-ui, sans-serif';
  chartCtx.textAlign  = 'right';
  for (let g = 0; g <= 4; g++) {
    const val = maxP - (g / 4) * rangeP;
    const y   = pad.top + (g / 4) * innerH;
    chartCtx.fillText(Math.round(val) + ' kr', pad.left - 6, y + 4);
  }
}

function clearChart() {
  if (chartCtx && chartCanvas) {
    chartCtx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatKr(price) {
  return price != null ? price.toFixed(0) + ' kr' : '—';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  return d.toLocaleString('nb-NO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function relativeTime(iso) {
  if (!iso) return '';
  const d    = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return hrs  + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function isValidEmail(email) {
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearErrors() {
  $$('.field-error').forEach(e => { e.textContent = ''; });
}
