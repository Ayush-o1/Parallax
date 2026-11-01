'use strict';

const state = {
  view: 'overview',
  token: sessionStorage.getItem('parallaxToken') || '',
  vehicles: { items: [], cursor: null, hasMore: false },
  ingestions: { items: [], cursor: null, hasMore: false },
  quarantine: { items: [], cursor: null, hasMore: false },
  detail: { telemetry: [], cursor: null, hasMore: false },
  selectedVehicleId: null,
};
const $ = (selector) => document.querySelector(selector);
let socket;
let searchTimer;
let quarantineTimer;
let refreshTimer;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const dateText = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const numberText = (value, digits = 1) => value === null || value === undefined ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
const oemName = (source) => String(source || 'Unknown').replace(/^OEM_/, 'OEM ').replaceAll('_', ' ');

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('authorization', `Bearer ${state.token}`);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  let response;
  try { response = await fetch(path, { ...options, headers }); }
  catch { throw new Error('Could not reach the Parallax API. Check that the local services are running.'); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) clearCredentials('Your API client session expired or was revoked. Connect again to continue.');
    throw new Error(payload.error?.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function clearCredentials(message = '') {
  state.token = '';
  sessionStorage.removeItem('parallaxToken');
  if (socket) { socket.disconnect(); socket = null; }
  $('#disconnect-button').classList.add('hidden');
  $('#credentials-open').classList.remove('hidden');
  $('#credentials-panel').classList.remove('hidden');
  $('#credentials-message').textContent = message;
  setConnection('degraded', 'API online · sign-in required');
}

function setConnection(tone, label, detail) {
  const dot = $('#connection-dot');
  dot.className = `connection-dot ${tone}`;
  $('#system-label').textContent = label;
  if (detail !== undefined) $('#last-refresh').textContent = detail;
}

function setTenant(organization) {
  if (!organization?.name) return;
  const initial = organization.name.trim().charAt(0).toUpperCase() || 'O';
  $('#tenant-label').innerHTML = `<span class="tenant-avatar">${esc(initial)}</span><span>${esc(organization.name)}</span>`;
}

function showError(error) {
  $('#error-banner').textContent = error.message || String(error);
  $('#error-banner').classList.remove('hidden');
  if (/reach the Parallax API/i.test(error.message || '')) setConnection('offline', 'API unavailable', 'Check local services');
}
function clearError() { $('#error-banner').classList.add('hidden'); $('#error-banner').textContent = ''; }
function loading(id, message = 'Loading live data…') { $(id).innerHTML = `<div class="loading-state" role="status">${esc(message)}</div>`; }
function empty(title, note) { return `<div class="empty-state"><strong>${esc(title)}</strong><span>${esc(note)}</span></div>`; }
function badge(status) {
  const value = String(status || 'UNKNOWN');
  const tone = ['ACCEPTED', 'COMPLETED', 'DUPLICATE', 'ACTIVE'].includes(value) ? 'good'
    : ['PROCESSING', 'RECEIVED', 'STALE', 'ACCEPTED_WITH_WARNINGS'].includes(value) ? 'warn'
      : ['QUARANTINED', 'MALFORMED', 'COMPLETED_WITH_ERRORS', 'OFFLINE', 'ODOMETER_REGRESSION'].includes(value) ? 'bad' : '';
  return `<span class="badge ${tone}">${esc(value.replaceAll('_', ' '))}</span>`;
}
function metric(label, value, note, icon, tone = '') {
  return `<article class="metric-card ${tone}"><div class="metric-topline"><span class="metric-label">${esc(label)}</span><span class="metric-icon" aria-hidden="true">${esc(icon)}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></article>`;
}
function makeTable(headers, rows) {
  return `<table class="data-table"><thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function vehicleStatus(vehicle) { return vehicle.connectivityStatus || (vehicle.state ? 'STALE' : 'OFFLINE'); }
function vehicleRow(vehicle, { showStatus = true } = {}) {
  const reading = vehicle.state?.latestReading;
  const status = vehicleStatus(vehicle);
  return `<tr data-id="${esc(vehicle.id)}" tabindex="0" role="button" aria-label="Inspect vehicle ${esc(vehicle.vin)}">
    <td class="vin">${esc(vehicle.vin)}</td><td><span class="oem">${esc(oemName(vehicle.source))}</span></td>
    <td>${reading ? `${numberText(reading.speedKph)} km/h` : '—'}</td>
    <td>${reading ? `${numberText(reading.fuelPercent, 0)}%` : '—'}</td>
    ${showStatus ? `<td><span class="state-pill ${status.toLowerCase()}">${esc(status)}</span></td>` : ''}
    <td>${esc(dateText(vehicle.state?.lastEventTime))}</td>
  </tr>`;
}

function renderSourceBreakdown(items, total) {
  const sources = [['OEM_ALPHA', 'OEM Alpha'], ['OEM_BETA', 'OEM Beta'], ['OEM_GAMMA', 'OEM Gamma']];
  $('#source-breakdown').innerHTML = sources.map(([key, label]) => {
    const count = items?.[key] || 0;
    const percent = total ? Math.round((count / total) * 100) : 0;
    return `<div class="source-row"><span>${label}</span><div class="source-track" aria-label="${percent}% of fleet"><div class="source-fill" style="width:${percent}%"></div></div><strong>${count}</strong></div>`;
  }).join('');
}

function renderEvents(events) {
  if (!events.length) return empty('No operational events', 'Events will appear here when telemetry crosses a detection rule.');
  return events.slice(0, 6).map((event) => `<div class="event-item"><span class="event-icon" aria-hidden="true">${event.eventType === 'HARD_BRAKING' ? '↘' : event.eventType === 'TRIP_STARTED' ? '▶' : '!'}</span><div class="event-copy"><strong>${esc(event.eventType.replaceAll('_', ' '))} ${badge(event.severity)}</strong><p>${esc(event.vehicle?.vin || 'Vehicle')} · ${esc(event.explanation)} · ${esc(dateText(event.occurredAt))}</p></div></div>`).join('');
}

function renderReadingRows(readings) {
  if (!readings.length) return empty('No telemetry readings yet', 'Start a local simulator to send synthetic vehicle data.');
  const rows = readings.map((reading) => `<tr data-id="${esc(reading.vehicle.id)}" tabindex="0" role="button" aria-label="Inspect telemetry for ${esc(reading.vehicle.vin)}"><td>${esc(dateText(reading.eventTime))}</td><td class="vin">${esc(reading.vehicle.vin)}</td><td><span class="oem">${esc(oemName(reading.source))}</span></td><td>${numberText(reading.speedKph)} km/h</td><td>${numberText(reading.fuelPercent, 0)}%</td><td>${reading.odometerSuspicious ? badge('ODOMETER_REGRESSION') : '—'}</td></tr>`).join('');
  return makeTable(['Event time', 'VIN', 'OEM', 'Speed', 'Fuel', 'Data quality'], rows);
}

async function loadOverview() {
  ['#metrics', '#overview-vehicles', '#source-breakdown', '#overview-events', '#recent-readings'].forEach((selector) => loading(selector));
  const [summary, vehicleResult, readings, events] = await Promise.all([
    api('/api/v1/summary'), api('/api/v1/vehicles?limit=8'),
    api('/api/v1/telemetry/recent?limit=8'), api('/api/v1/events/recent?limit=6'),
  ]);
  const d = summary.data;
  setTenant(d.organization);
  const eventTotal = Object.values(d.ingestionEvents || {}).reduce((sum, count) => sum + count, 0);
  $('#metrics').innerHTML = [
    metric('Registered vehicles', d.vehicles.total, 'Across this organization', '◫'),
    metric('Active vehicles', d.vehicles.active, 'Reporting within expected interval', '●'),
    metric('Stale or offline', d.vehicles.stale, 'No recent state update', '◷', d.vehicles.stale ? 'alert' : ''),
    metric('Telemetry event attempts', eventTotal, 'Accepted, duplicate, or quarantined', '↯'),
    metric('Quarantined records', d.quarantined, 'Requests and individual events', '⚑', d.quarantined ? 'danger' : ''),
  ].join('');
  renderSourceBreakdown(d.vehiclesBySource, d.vehicles.total);
  const vehicleRowsHtml = vehicleResult.data.length
    ? vehicleResult.data.map((vehicle) => vehicleRow(vehicle)).join('')
    : `<tr><td colspan="6">${empty('No registered vehicles', 'Register a vehicle and start a simulator to see fleet activity.')}</td></tr>`;
  $('#overview-vehicles').innerHTML = makeTable(['VIN', 'OEM', 'Speed', 'Fuel', 'Status', 'Last event'], vehicleRowsHtml);
  $('#recent-readings').innerHTML = renderReadingRows(readings.data);
  $('#overview-events').innerHTML = renderEvents(events.data);
}

function renderVehiclePagination(page, count) {
  $('#vehicles-pagination').innerHTML = `<span class="pagination-copy">Showing ${count} vehicle${count === 1 ? '' : 's'}${page.hasMore ? ' · more available' : ''}</span>${page.hasMore ? '<button class="button secondary" type="button" id="vehicle-more">Load more vehicles</button>' : ''}`;
  const countLabel = $('#vehicle-result-count');
  countLabel.textContent = page.hasMore ? `${count}+ results` : `${count} result${count === 1 ? '' : 's'}`;
}

async function loadVehicles({ append = false } = {}) {
  const pageState = state.vehicles;
  if (!append) { pageState.items = []; pageState.cursor = null; pageState.hasMore = false; }
  loading('#vehicles-table');
  const params = new URLSearchParams({ limit: '25' });
  if ($('#vehicle-search').value.trim()) params.set('search', $('#vehicle-search').value.trim());
  if ($('#source-filter').value) params.set('source', $('#source-filter').value);
  if ($('#vehicle-status-filter').value) params.set('status', $('#vehicle-status-filter').value);
  if (append && pageState.cursor) params.set('cursor', pageState.cursor);
  const result = await api(`/api/v1/vehicles?${params}`);
  pageState.items = append ? [...pageState.items, ...result.data] : result.data;
  pageState.cursor = result.page.nextCursor;
  pageState.hasMore = result.page.hasMore;
  $('#vehicles-table').innerHTML = pageState.items.length
    ? makeTable(['VIN', 'OEM', 'Speed', 'Fuel', 'Status', 'Last event'], pageState.items.map((vehicle) => vehicleRow(vehicle)).join(''))
    : empty('No vehicles match these filters', 'Try another VIN, OEM, or connection status.');
  renderVehiclePagination(result.page, pageState.items.length);
}

function renderDetailTelemetry(readings) {
  if (!readings.length) return empty('No telemetry history', 'This vehicle has not submitted a normalized reading.');
  const rows = readings.map((reading) => `<tr><td>${esc(dateText(reading.eventTime))}</td><td>${numberText(reading.speedKph)} km/h</td><td>${reading.odometerKm === null ? '—' : `${numberText(reading.odometerKm)} km`}</td><td>${numberText(reading.fuelPercent, 0)}%</td><td>${reading.odometerSuspicious ? badge('ODOMETER_REGRESSION') : badge('ACCEPTED')}</td></tr>`).join('');
  return makeTable(['Event time', 'Speed', 'Odometer', 'Fuel', 'Quality'], rows);
}

async function openVehicle(id) {
  state.selectedVehicleId = id;
  state.detail = { telemetry: [], cursor: null, hasMore: false };
  const detail = $('#vehicle-detail');
  detail.classList.remove('hidden');
  detail.innerHTML = '<div class="loading-state" role="status">Loading vehicle details…</div>';
  try {
    const [vehicleResult, stateResult, history, events] = await Promise.all([
      api(`/api/v1/vehicles/${id}`), api(`/api/v1/vehicles/${id}/state`),
      api(`/api/v1/vehicles/${id}/telemetry?limit=10`), api(`/api/v1/vehicles/${id}/events?limit=8`),
    ]);
    if (state.selectedVehicleId !== id) return;
    const vehicle = vehicleResult.data;
    const vehicleState = stateResult.data;
    state.detail.telemetry = history.data;
    state.detail.cursor = history.page.nextCursor;
    state.detail.hasMore = history.page.hasMore;
    detail.innerHTML = `
      <div class="detail-heading"><div><h2>${esc(vehicle.vin)} <span class="oem">${esc(oemName(vehicle.source))}</span> ${badge(vehicleStatus(vehicle))}</h2><p>Live state and event-time history for this vehicle.</p></div><button id="close-detail" class="button secondary" type="button">Close details</button></div>
      <div class="detail-grid">
        <div class="detail-stat"><span>Current speed</span><strong>${vehicleState?.latestReading ? `${numberText(vehicleState.latestReading.speedKph)} km/h` : '—'}</strong></div>
        <div class="detail-stat"><span>Trusted odometer</span><strong>${vehicleState?.trustedOdometerKm == null ? '—' : `${numberText(vehicleState.trustedOdometerKm)} km`}</strong></div>
        <div class="detail-stat"><span>Fuel</span><strong>${vehicleState?.latestReading ? `${numberText(vehicleState.latestReading.fuelPercent, 0)}%` : '—'}</strong></div>
        <div class="detail-stat"><span>Last event time</span><strong>${esc(dateText(vehicleState?.lastEventTime))}</strong></div>
      </div>
      <h3 class="detail-section-title">Telemetry history</h3><div id="detail-history" class="table-wrap">${renderDetailTelemetry(state.detail.telemetry)}</div>
      <div id="detail-pagination" class="pagination">${state.detail.hasMore ? '<button class="button secondary" id="detail-more" type="button">Load older readings</button>' : '<span class="pagination-copy">End of available history</span>'}</div>
      <div class="panel-divider"></div><h3 class="detail-section-title">Operational events</h3><div class="event-list">${renderEvents(events.data)}</div>`;
  } catch (error) { showError(error); detail.innerHTML = `<div class="error-banner">${esc(error.message)}</div>`; }
}

function renderRequestOutcomes(outcomes = {}) {
  const list = Object.entries(outcomes).filter(([, count]) => count > 0);
  if (!list.length) return '<span class="subtle-label">No event outcomes</span>';
  return `<span class="outcome-list">${list.map(([status, count]) => `${badge(status)} <span>${count}</span>`).join(' ')}</span>`;
}

function renderPagination(element, collection, label) {
  const shown = collection.items.length;
  $(element).innerHTML = `<span class="pagination-copy">${shown} ${label}${shown === 1 ? '' : 's'}${collection.hasMore ? ' · more available' : ''}</span>${collection.hasMore ? `<button class="button secondary" type="button" id="${label}-more">Load more</button>` : ''}`;
}

async function loadIngestion({ append = false } = {}) {
  const collection = state.ingestions;
  if (!append) { collection.items = []; collection.cursor = null; collection.hasMore = false; }
  loading('#ingestion-table');
  const params = new URLSearchParams({ limit: '25' });
  if ($('#ingestion-status').value) params.set('status', $('#ingestion-status').value);
  if (append && collection.cursor) params.set('cursor', collection.cursor);
  const result = await api(`/api/v1/ingestions?${params}`);
  collection.items = append ? [...collection.items, ...result.data] : result.data;
  collection.cursor = result.page.nextCursor;
  collection.hasMore = result.page.hasMore;
  const rows = collection.items.map((request) => `<tr><td>${esc(dateText(request.receivedAt))}</td><td>${esc(oemName(request.source))}</td><td>${badge(request.status)}</td><td>${request._count.events}</td><td>${renderRequestOutcomes(request.outcomes)}</td><td>${request._count.quarantineRecords}</td><td>${esc(request.errorCode || request.errorDetail || '—')}</td></tr>`).join('');
  $('#ingestion-table').innerHTML = rows ? makeTable(['Received', 'Source', 'Request status', 'Events', 'Event outcomes', 'Quarantines', 'Request error'], rows) : empty('No ingestion requests', 'Receipts will appear after a simulator or OEM client sends telemetry.');
  renderPagination('#ingestion-pagination', collection, 'request');
}

async function loadQuarantine({ append = false } = {}) {
  const collection = state.quarantine;
  if (!append) { collection.items = []; collection.cursor = null; collection.hasMore = false; }
  loading('#quarantine-table');
  const params = new URLSearchParams({ limit: '25' });
  if ($('#quarantine-reason').value.trim()) params.set('reason', $('#quarantine-reason').value.trim());
  if (append && collection.cursor) params.set('cursor', collection.cursor);
  const result = await api(`/api/v1/quarantine?${params}`);
  collection.items = append ? [...collection.items, ...result.data] : result.data;
  collection.cursor = result.page.nextCursor;
  collection.hasMore = result.page.hasMore;
  const rows = collection.items.map((record) => {
    const payload = record.event?.payload ? JSON.stringify(record.event.payload, null, 2) : record.rawRequestBody;
    const scope = record.eventId ? 'Event' : 'Request';
    return `<tr><td>${esc(dateText(record.createdAt))}</td><td>${esc(oemName(record.source))}</td><td><span class="badge ${record.eventId ? 'warn' : 'bad'}">${scope}</span></td><td class="vin">${esc(record.rawVin || '—')}</td><td>${badge(record.reason)}</td><td>${esc(record.detail)}</td><td><details><summary>Inspect payload</summary><div class="payload-inspector"><div><strong>Request received</strong><span>${esc(dateText(record.request.receivedAt))}</span></div><pre>${esc(payload || 'No payload was parsed.')}</pre><div><strong>Original body (Base64)</strong><pre>${esc(record.rawRequestBase64)}</pre></div></div></details></td></tr>`;
  }).join('');
  $('#quarantine-table').innerHTML = rows ? makeTable(['Created', 'Source', 'Scope', 'VIN', 'Reason', 'Details', 'Original payload'], rows) : empty('No quarantined data', 'Rejected requests and events will appear here with their original payload.');
  renderPagination('#quarantine-pagination', collection, 'record');
}

async function loadView() {
  clearError();
  $('#page-title').textContent = state.view[0].toUpperCase() + state.view.slice(1);
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('hidden', view.id !== `view-${state.view}`));
  const active = document.querySelector(`.nav-link[data-view="${state.view}"]`);
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === active));
  try {
    if (state.view === 'overview') await loadOverview();
    if (state.view === 'vehicles') await loadVehicles();
    if (state.view === 'ingestion') await loadIngestion();
    if (state.view === 'quarantine') await loadQuarantine();
    const stamp = new Date();
    $('#last-refresh').textContent = `Updated ${stamp.toLocaleTimeString()}`;
    $('#footer-time').textContent = stamp.toLocaleDateString();
    $('#overview-freshness').textContent = `Updated ${stamp.toLocaleTimeString()}`;
    setConnection('online', state.token ? 'API and live updates connected' : 'API connected · demo access', 'Services responding');
  } catch (error) {
    showError(error);
    if (!state.token && error.message.includes('bearer token')) {
      setConnection('degraded', 'API online · sign-in required', 'Connect an API client');
      $('#credentials-panel').classList.remove('hidden');
    }
  }
}

function connectRealtime() {
  if (!state.token || typeof window.io !== 'function') return;
  if (socket) socket.disconnect();
  socket = window.io({ auth: { token: state.token } });
  socket.on('connect', () => setConnection('online', 'API and live updates connected', 'Realtime channel connected'));
  socket.on('connect_error', () => setConnection('degraded', 'API connected · live updates unavailable', 'Realtime channel unavailable'));
  for (const event of ['vehicle.state.updated', 'ingestion.event.processed', 'operational.event.created']) {
    socket.on(event, () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => loadView().catch(showError), 250);
    });
  }
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  history.replaceState(null, '', `#${state.view}`);
  loadView();
}));
$('#refresh-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await loadView(); } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
$('#credentials-toggle').addEventListener('click', () => $('#credentials-panel').classList.toggle('hidden'));
$('#credentials-open').addEventListener('click', () => $('#credentials-panel').classList.toggle('hidden'));
$('#disconnect-button').addEventListener('click', () => { clearCredentials('Disconnected from the API client.'); clearError(); });
$('#credentials-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const message = $('#credentials-message');
  message.classList.remove('error');
  message.textContent = 'Connecting…';
  const submit = formElement.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api('/api/v1/auth/token', { method: 'POST', body: JSON.stringify({
      grant_type: 'client_credentials', client_id: form.get('client_id'), client_secret: form.get('client_secret'),
    }) });
    state.token = result.data.access_token;
    sessionStorage.setItem('parallaxToken', state.token);
    const tenant = await api('/api/v1/summary');
    setTenant(tenant.data.organization);
    connectRealtime();
    formElement.reset();
    $('#credentials-panel').classList.add('hidden');
    $('#credentials-open').classList.add('hidden');
    $('#disconnect-button').classList.remove('hidden');
    message.textContent = 'Connected.';
    await loadView();
  } catch (error) { message.textContent = error.message; message.classList.add('error'); }
  finally { submit.disabled = false; }
});

$('#vehicle-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadVehicles().catch(showError), 250); });
$('#source-filter').addEventListener('change', () => loadVehicles().catch(showError));
$('#vehicle-status-filter').addEventListener('change', () => loadVehicles().catch(showError));
$('#ingestion-status').addEventListener('change', () => loadIngestion().catch(showError));
$('#quarantine-reason').addEventListener('input', () => { clearTimeout(quarantineTimer); quarantineTimer = setTimeout(() => loadQuarantine().catch(showError), 250); });

$('#vehicles-table').addEventListener('click', (event) => {
  if (event.target.closest('#vehicle-more')) { loadVehicles({ append: true }).catch(showError); return; }
  const row = event.target.closest('tr[data-id]');
  if (row) openVehicle(row.dataset.id);
});
$('#vehicles-table').addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-id]')) { event.preventDefault(); openVehicle(event.target.dataset.id); }
});
$('#overview-vehicles').addEventListener('click', (event) => {
  if (event.target.closest('[data-view="vehicles"]')) { state.view = 'vehicles'; loadView(); return; }
  const row = event.target.closest('tr[data-id]');
  if (row) { state.view = 'vehicles'; loadView().then(() => openVehicle(row.dataset.id)).catch(showError); }
});
$('#recent-readings').addEventListener('click', (event) => { const row = event.target.closest('tr[data-id]'); if (row) { state.view = 'vehicles'; loadView().then(() => openVehicle(row.dataset.id)).catch(showError); } });
$('#recent-readings').addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-id]')) { event.preventDefault(); state.view = 'vehicles'; loadView().then(() => openVehicle(event.target.dataset.id)).catch(showError); } });
$('#vehicle-detail').addEventListener('click', (event) => {
  if (event.target.closest('#close-detail')) { $('#vehicle-detail').classList.add('hidden'); state.selectedVehicleId = null; }
  if (event.target.closest('#detail-more')) loadVehicleHistory(true).catch(showError);
});
$('#ingestion-pagination').addEventListener('click', (event) => { if (event.target.closest('#request-more')) loadIngestion({ append: true }).catch(showError); });
$('#quarantine-pagination').addEventListener('click', (event) => { if (event.target.closest('#record-more')) loadQuarantine({ append: true }).catch(showError); });

async function loadVehicleHistory(append = false) {
  if (!state.selectedVehicleId) return;
  const page = state.detail;
  const params = new URLSearchParams({ limit: '10' });
  if (append && page.cursor) params.set('cursor', page.cursor);
  const result = await api(`/api/v1/vehicles/${state.selectedVehicleId}/telemetry?${params}`);
  page.telemetry = append ? [...page.telemetry, ...result.data] : result.data;
  page.cursor = result.page.nextCursor;
  page.hasMore = result.page.hasMore;
  $('#detail-history').innerHTML = renderDetailTelemetry(page.telemetry);
  $('#detail-pagination').innerHTML = page.hasMore ? '<button class="button secondary" id="detail-more" type="button">Load older readings</button>' : '<span class="pagination-copy">End of available history</span>';
}

async function initialize() {
  const hashView = location.hash.slice(1);
  if (['overview', 'vehicles', 'ingestion', 'quarantine'].includes(hashView)) state.view = hashView;
  $('#disconnect-button').classList.toggle('hidden', !state.token);
  $('#credentials-open').classList.toggle('hidden', Boolean(state.token));
  if (state.token) connectRealtime();
  try {
    const health = await fetch('/health').then((response) => response.ok ? response.json() : Promise.reject(new Error('Health check failed')));
    setConnection('online', state.token ? 'API available · checking access' : 'API online · sign-in required', `Service ${health.data.version}`);
    if (state.token || health.data.nodeEnv !== 'production') {
      try { setTenant((await api('/api/v1/summary')).data.organization); }
      catch (error) { if (state.token) clearCredentials(error.message); }
    }
  } catch { setConnection('offline', 'API unavailable', 'Check local services'); }
  await loadView();
}

initialize().catch(showError);
