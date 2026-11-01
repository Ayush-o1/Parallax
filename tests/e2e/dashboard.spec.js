'use strict';

const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

function vin() {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  const suffix = [...crypto.randomBytes(17)].map((byte) => alphabet[byte % alphabet.length]).join('');
  return suffix.slice(0, 17);
}

test('dashboard covers fleet, receipt inspection, quarantine, events, and mobile layout', async ({ page, request }) => {
  const browserErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`); });
  const vehicleVin = vin();
  const vehicleResponse = await request.post('/api/v1/vehicles', { data: { vin: vehicleVin, source: 'OEM_ALPHA' } });
  expect(vehicleResponse.status()).toBe(201);
  const eventTime = new Date().toISOString();
  const valid = { vin: vehicleVin, event_id: `e2e-${crypto.randomUUID()}`, timestamp: eventTime,
    speed: 25, speed_unit: 'mph', odometer: 1200, latitude: 12.9, longitude: 77.5, fuel_level: 70 };
  const invalid = { ...valid, vin: 'INVALID', event_id: `bad-${crypto.randomUUID()}` };
  const ingestionResponse = await request.post('/api/v1/ingest/OEM_ALPHA', { data: [valid, invalid] });
  expect(ingestionResponse.status()).toBe(207);

  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.goto('/');
  expect(response.status()).toBe(200);
  await expect(page.locator('link[rel="stylesheet"]')).toHaveAttribute('href', /styles\.css/);
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.body).fontFamily)).not.toBe('"Times New Roman"');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('.metric-card').first()).toBeVisible();

  await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
  await page.locator('#vehicle-search').fill(vehicleVin);
  const vehicleRow = page.locator('#vehicles-table tr[data-id]').first();
  await expect(vehicleRow).toContainText(vehicleVin);
  await vehicleRow.click();
  await expect(page.locator('#vehicle-detail')).toBeVisible();
  await expect(page.locator('#vehicle-detail')).toContainText(vehicleVin);

  await page.getByRole('button', { name: 'Ingestion', exact: true }).click();
  const inspectRequest = page.locator('[data-inspect-ingestion]').first();
  await expect(inspectRequest).toBeVisible();
  await inspectRequest.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#ingestion-detail')).toContainText('Original request body');
  await expect(page.locator('#ingestion-detail')).toContainText('ACCEPTED');
  await page.locator('[data-close-dialog]').click();

  await page.getByRole('button', { name: 'Quarantine', exact: true }).click();
  await expect(page.locator('#quarantine-table')).toContainText('INVALID VIN');
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.locator('#events-table')).toContainText(vehicleVin);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Vehicles', exact: true }).click();
  await page.locator('#vehicle-search').fill(vehicleVin);
  await expect(page.locator('#vehicles-table')).toContainText(vehicleVin);
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(browserErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(badResponses).toEqual([]);
});
