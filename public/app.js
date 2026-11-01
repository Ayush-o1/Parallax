'use strict';

const state = { view: 'overview', token: sessionStorage.getItem('parallaxToken') || '', vehicles: [], vehicleCursor: null };
let socket;
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const dateText = (value) => value ? new Date(value).toLocaleString() : '—';

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('authorization', `Bearer ${state.token}`);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) {
      state.token = '';
      sessionStorage.removeItem('parallaxToken');
      $('#credentials-panel').classList.remove('hidden');
    }
    throw new Error(payload.error?.message || `Request failed (${response.status})`);
  }
  return payload;
}

function showError(error) {
  const banner = $('#error-banner');
  banner.textContent = error.message;
  banner.classList.remove('hidden');
}
function clearError() { $('#error-banner').classList.add('hidden'); }
function loading(id) { $(id).innerHTML = '<div class="loading-state">Loading live data…</div>'; }
function empty(message) { return `<div class="empty-state">${esc(message)}</div>`; }

function badge(status) {
  const tone = ['ACCEPTED', 'COMPLETED', 'DUPLICATE'].includes(status) ? 'good'
    : ['QUARANTINED', 'COMPLETED_WITH_ERRORS', 'MALFORMED', 'ACCEPTED_WITH_WARNINGS'].includes(status) ? 'bad'
      : 'warn';
  return `<span class="badge ${tone}">${esc(status)}</span>`;
}

function metric(label, value, note, alert = false) {
  return `<article class="metric-card${alert ? ' alert' : ''}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
}

function vehicleRows(vehicles, target, summary = false) {
  if (!vehicles.length) { $(target).innerHTML = empty('No vehicles have reported yet. Register a vehicle or run a simulator.'); return; }
  const shown = summary ? vehicles.slice(0, 8) : vehicles;
  const rows = shown.map((vehicle) => {
    const reading = vehicle.state?.latestReading;
    const staleAfter = vehicle.source === 'OEM_GAMMA' ? 45_000 : vehicle.source === 'OEM_BETA' ? 180_000 : 90_000;
    const lastAt = vehicle.state?.lastEventTime;
    const status = !lastAt ? 'offline' : Date.now() - new Date(lastAt).getTime() > staleAfter ? 'stale' : 'active';
    return `<tr data-id="${esc(vehicle.id)}"><td class="vin">${esc(vehicle.vin)}</td><td><span class="oem">${esc(vehicle.source.replace('OEM_', ''))}</span></td><td>${reading ? `${esc(Number(reading.speedKph).toFixed(1))} km/h` : '—'}</td><td>${reading ? `${esc(Number(reading.fuelPercent).toFixed(0))}%` : '—'}</td><td><span class="state-pill ${status}">${status}</span></td><td>${esc(dateText(lastAt))}</td></tr>`;
  }).join('');
  $(target).innerHTML = `<table class="data-table"><thead><tr><th>VIN</th><th>OEM</th><th>Speed</th><th>Fuel</th><th>Connectivity</th><th>Last event</th></tr></thead><tbody>${rows}</tbody></table>${!summary && state.vehicleCursor ? '<button class="button secondary load-more" id="vehicle-more">Load more</button>' : ''}`;
}

function eventsList(events) {
  if (!events.length) return empty('No operational events recorded.');
  return events.slice(0, 6).map((event) => `<div class="event-item"><span class="event-icon">${event.eventType === 'HARD_BRAKING' ? '↘' : event.eventType === 'TRIP_STARTED' ? '▶' : '!'}</span><div class="event-copy"><strong>${esc(event.eventType.replaceAll('_', ' '))} <span class="badge ${event.severity === 'HIGH' ? 'bad' : 'warn'}">${esc(event.severity)}</span></strong><p>${esc(event.explanation)} · ${esc(dateText(event.occurredAt))}</p></div></div>`).join('');
}

function renderSourceBreakdown(items, total) {
  const order = ['OEM_ALPHA', 'OEM_BETA', 'OEM_GAMMA'];
  $('#source-breakdown').innerHTML = order.map((source) => {
    const count = items[source] || 0;
    return `<div class="source-row"><span>${source.replace('OEM_', 'OEM ')}</span><div class="source-track"><progress class="source-progress" value="${count}" max="${Math.max(total, 1)}" aria-label="${source} vehicles"></progress></div><strong>${count}</strong></div>`;
  }).join('');
}

async function loadOverview() {
  ['#metrics', '#overview-vehicles', '#source-breakdown', '#overview-events'].forEach(loading);
  const [summary, vehicleResult] = await Promise.all([
    api('/api/v1/summary'), api('/api/v1/vehicles?limit=25'),
  ]);
  const d = summary.data;
  const processed = ['ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'DUPLICATE'].reduce((sum, key) => sum + (d.ingestionEvents[key] || 0), 0);
  $('#metrics').innerHTML = [
    metric('Registered vehicles', d.vehicles.total, 'In this organization'),
    metric('Active vehicles', d.vehicles.active, 'Within reporting interval'),
    metric('Stale vehicles', d.vehicles.stale, 'No recent state update', d.vehicles.stale > 0),
    metric('Processed events', processed, 'Accepted or duplicate receipts'),
    metric('Quarantined', d.quarantined, 'Request and event records', d.quarantined > 0),
  ].join('');
  state.vehicles = vehicleResult.data;
  vehicleRows(state.vehicles, '#overview-vehicles', true);
  renderSourceBreakdown(d.vehiclesBySource, d.vehicles.total);
  if (state.vehicles[0]) {
    const result = await api(`/api/v1/vehicles/${state.vehicles[0].id}/events?limit=8`);
    $('#overview-events').innerHTML = eventsList(result.data);
  } else $('#overview-events').innerHTML = empty('Operational events will appear after telemetry is processed.');
}

async function loadVehicles(reset = true) {
  if (reset) { state.vehicleCursor = null; state.vehicles = []; }
  loading('#vehicles-table');
  const params = new URLSearchParams({ limit: '25' });
  if ($('#vehicle-search').value.trim()) params.set('search', $('#vehicle-search').value.trim());
  if ($('#source-filter').value) params.set('source', $('#source-filter').value);
  if (!reset && state.vehicleCursor) params.set('cursor', state.vehicleCursor);
  const result = await api(`/api/v1/vehicles?${params}`);
  state.vehicles = reset ? result.data : [...state.vehicles, ...result.data];
  state.vehicleCursor = result.page.nextCursor;
  vehicleRows(state.vehicles, '#vehicles-table');
}

async function openVehicle(id) {
  const vehicle = state.vehicles.find((item) => item.id === id) || (await api(`/api/v1/vehicles/${id}`)).data;
  const detail = $('#vehicle-detail');
  detail.classList.remove('hidden');
  detail.innerHTML = `<div class="loading-state">Loading vehicle history…</div>`;
  const [stateResult, history, events] = await Promise.all([
    api(`/api/v1/vehicles/${id}/state`), api(`/api/v1/vehicles/${id}/telemetry?limit=10`), api(`/api/v1/vehicles/${id}/events?limit=10`),
  ]);
  const latest = stateResult.data?.latestReading;
  const historyRows = history.data.map((reading) => `<tr><td>${esc(dateText(reading.eventTime))}</td><td>${esc(Number(reading.speedKph).toFixed(1))} km/h</td><td>${reading.odometerKm === null ? '—' : `${esc(Number(reading.odometerKm).toFixed(1))} km`}</td><td>${esc(Number(reading.fuelPercent).toFixed(0))}%</td><td>${reading.odometerSuspicious ? badge('ACCEPTED_WITH_WARNINGS') : badge('ACCEPTED')}</td></tr>`).join('');
  detail.innerHTML = `<div class="panel-heading"><div><h2>${esc(vehicle.vin)} <span class="oem">${esc(vehicle.source)}</span></h2><p>Vehicle detail · latest state and event history</p></div><button class="text-button" id="close-detail">Close</button></div><div class="detail-grid"><div class="detail-stat"><span>Current speed</span><strong>${latest ? `${esc(Number(latest.speedKph).toFixed(1))} km/h` : '—'}</strong></div><div class="detail-stat"><span>Trusted odometer</span><strong>${stateResult.data?.trustedOdometerKm === null || !stateResult.data ? '—' : `${esc(Number(stateResult.data.trustedOdometerKm).toFixed(1))} km`}</strong></div><div class="detail-stat"><span>Fuel</span><strong>${latest ? `${esc(Number(latest.fuelPercent).toFixed(0))}%` : '—'}</strong></div><div class="detail-stat"><span>Last event time</span><strong>${esc(dateText(stateResult.data?.lastEventTime))}</strong></div></div><h3>Recent telemetry</h3>${historyRows ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Event time</th><th>Speed</th><th>Odometer</th><th>Fuel</th><th>Quality</th></tr></thead><tbody>${historyRows}</tbody></table></div>` : empty('No telemetry history yet.')}<div class="panel-divider"></div><h3>Operational events</h3><div class="event-list">${eventsList(events.data)}</div>`;
}

async function loadIngestion() {
  loading('#ingestion-table');
  const params = new URLSearchParams({ limit: '50' });
  if ($('#ingestion-status').value) params.set('status', $('#ingestion-status').value);
  const result = await api(`/api/v1/ingestions?${params}`);
  if (!result.data.length) { $('#ingestion-table').innerHTML = empty('No ingestion requests recorded.'); return; }
  $('#ingestion-table').innerHTML = `<table class="data-table"><thead><tr><th>Received</th><th>Source</th><th>Status</th><th>Events</th><th>Quarantine</th><th>Error</th></tr></thead><tbody>${result.data.map((row) => `<tr><td>${esc(dateText(row.receivedAt))}</td><td>${esc(row.source)}</td><td>${badge(row.status)}</td><td>${row._count.events}</td><td>${row._count.quarantineRecords}</td><td>${esc(row.errorCode || row.errorDetail || '—')}</td></tr>`).join('')}</tbody></table>`;
}

async function loadQuarantine() {
  loading('#quarantine-table');
  const params = new URLSearchParams({ limit: '50' });
  if ($('#quarantine-reason').value.trim()) params.set('reason', $('#quarantine-reason').value.trim());
  const result = await api(`/api/v1/quarantine?${params}`);
  if (!result.data.length) { $('#quarantine-table').innerHTML = empty('No quarantined data recorded.'); return; }
  $('#quarantine-table').innerHTML = `<table class="data-table"><thead><tr><th>Time</th><th>Source</th><th>VIN</th><th>Reason</th><th>Details</th><th>Payload</th></tr></thead><tbody>${result.data.map((row) => `<tr><td>${esc(dateText(row.createdAt))}</td><td>${esc(row.source)}</td><td class="vin">${esc(row.rawVin || '—')}</td><td>${badge(row.reason)}</td><td>${esc(row.detail)}</td><td><details><summary>View</summary><pre>${esc(row.event?.payload ? JSON.stringify(row.event.payload, null, 2) : row.rawRequestBody)}\n\nBase64: ${esc(row.rawRequestBase64)}</pre></details></td></tr>`).join('')}</tbody></table>`;
}

async function loadView() {
  clearError();
  $('#page-title').textContent = state.view[0].toUpperCase() + state.view.slice(1);
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${state.view}`));
  try {
    if (state.view === 'overview') await loadOverview();
    if (state.view === 'vehicles') await loadVehicles();
    if (state.view === 'ingestion') await loadIngestion();
    if (state.view === 'quarantine') await loadQuarantine();
    $('#last-refresh').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    $('#footer-time').textContent = new Date().toLocaleDateString();
    $('#system-label').textContent = 'API connected';
  } catch (error) {
    $('#system-label').textContent = 'API unavailable';
    showError(error);
  }
}

function connectRealtime() {
  if (typeof window.io !== 'function') return;
  if (socket) socket.disconnect();
  socket = window.io({ auth: state.token ? { token: state.token } : {} });
  socket.on('connect', () => { $('#system-label').textContent = 'API and live updates connected'; });
  socket.on('connect_error', () => { $('#system-label').textContent = 'API connected · live updates unavailable'; });
  socket.on('vehicle.state.updated', () => {
    clearTimeout(window.realtimeRefreshTimer);
    window.realtimeRefreshTimer = setTimeout(() => loadView(), 200);
  });
  socket.on('ingestion.event.processed', () => {
    clearTimeout(window.realtimeRefreshTimer);
    window.realtimeRefreshTimer = setTimeout(() => loadView(), 200);
  });
  socket.on('operational.event.created', () => loadView());
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  loadView();
}));
$('#refresh-button').addEventListener('click', loadView);
$('#credentials-toggle').addEventListener('click', () => $('#credentials-panel').classList.toggle('hidden'));
$('#credentials-open').addEventListener('click', () => $('#credentials-panel').classList.toggle('hidden'));
$('#credentials-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const message = $('#credentials-message');
  message.textContent = 'Connecting…';
  try {
    const result = await api('/api/v1/auth/token', { method: 'POST', body: JSON.stringify({
      grant_type: 'client_credentials', client_id: form.get('client_id'), client_secret: form.get('client_secret'),
    }) });
    state.token = result.data.access_token;
    sessionStorage.setItem('parallaxToken', state.token);
    connectRealtime();
    event.currentTarget.reset();
    $('#credentials-panel').classList.add('hidden');
    message.textContent = 'Connected.';
    loadView();
  } catch (error) { message.textContent = error.message; }
});
$('#vehicle-search').addEventListener('input', () => { clearTimeout(window.vehicleSearchTimer); window.vehicleSearchTimer = setTimeout(() => loadVehicles(), 250); });
$('#source-filter').addEventListener('change', () => loadVehicles());
$('#ingestion-status').addEventListener('change', loadIngestion);
$('#quarantine-reason').addEventListener('input', () => { clearTimeout(window.quarantineSearchTimer); window.quarantineSearchTimer = setTimeout(loadQuarantine, 250); });
$('#vehicles-table').addEventListener('click', (event) => {
  if (event.target.closest('#vehicle-more')) { loadVehicles(false).catch(showError); return; }
  const row = event.target.closest('tr[data-id]');
  if (row) openVehicle(row.dataset.id).catch(showError);
});
$('#overview-vehicles').addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-id]');
  if (row) { state.view = 'vehicles'; document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item.dataset.view === 'vehicles')); loadView().then(() => openVehicle(row.dataset.id)).catch(showError); }
});
$('#vehicle-detail').addEventListener('click', (event) => { if (event.target.closest('#close-detail')) $('#vehicle-detail').classList.add('hidden'); });

connectRealtime();
loadView();
