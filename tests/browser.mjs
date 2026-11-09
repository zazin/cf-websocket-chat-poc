import { chromium, expect } from '@playwright/test';
const base = process.argv[2];
if (!base) throw new Error('Usage: npm run test:browser -- FRONTEND_URL');
const browser = await chromium.launch({ headless: true });
const room = `browser-${Date.now()}`;
try {
  const contexts = await Promise.all([browser.newContext(), browser.newContext({ viewport: { width: 390, height: 844 } })]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const errors = [];
  const transports = [];
  await Promise.all(pages.map((page, i) => page.routeWebSocket('**/ws?**', route => {
    route.connectToServer(); transports[i] = route;
  })));
  for (const page of pages) page.on('pageerror', e => errors.push(e.message));
  await Promise.all(pages.map(async (page, i) => {
    await page.goto(base);
    await page.getByLabel('Your nickname').fill(i ? 'Browser Bob' : 'Browser Alice');
    await page.getByLabel('Room', { exact: true }).fill(room);
    await page.getByRole('button', { name: 'Join room' }).click();
    await expect(page.locator('#status')).toHaveText('Connected');
  }));
  await expect(pages[0].locator('#participants')).toHaveText('2 connected');
  const text = `Hello from browser ${Date.now()} <img src=x onerror=alert(1)>`;
  await pages[0].getByLabel('Message', { exact: true }).fill(text);
  await pages[0].getByRole('button', { name: 'Send' }).click();
  await expect(pages[1].locator('.bubble').filter({ hasText: text })).toBeVisible();
  await expect(pages[1].locator('#messages img')).toHaveCount(0);
  await pages[1].getByLabel('Message', { exact: true }).fill('Reply from mobile Bob');
  await pages[1].getByRole('button', { name: 'Send' }).click();
  await expect(pages[0].getByText('Reply from mobile Bob', { exact: true })).toBeVisible();
  // Interrupt the real proxied WebSocket and let the UI's backoff reconnect it.
  await transports[0].close({ code: 1012, reason: 'Test restart' });
  await expect(pages[0].locator('#status')).toHaveText('Reconnecting…');
  await expect(pages[0].locator('#status')).toHaveText('Connected', { timeout: 15000 });
  await expect(pages[0].getByText('Reply from mobile Bob', { exact: true })).toHaveCount(1);
  await pages[1].getByLabel('Message', { exact: true }).fill('After automatic reconnect');
  await pages[1].getByRole('button', { name: 'Send' }).click();
  await expect(pages[0].getByText('After automatic reconnect', { exact: true })).toBeVisible();
  await pages[0].reload();
  await pages[0].getByLabel('Your nickname').fill('Browser Alice');
  await pages[0].getByLabel('Room', { exact: true }).fill(room);
  await pages[0].getByRole('button', { name: 'Join room' }).click();
  await expect(pages[0].getByText('Reply from mobile Bob', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS: desktop/mobile contexts connect, exchange messages in actual UI, render text safely, automatically reconnect, and recover persisted history.');
} finally { await browser.close(); }
