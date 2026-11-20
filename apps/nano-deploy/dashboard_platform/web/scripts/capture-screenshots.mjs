import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Use the actual frontend with isolated, explicitly simulated device responses.
// Disable local .env loading and override API_BASE so no robot endpoint is used.
const output = new URL('../../../../../docs/screenshots/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({
  envFile: false,
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 0, open: false },
});
let browser;
const errors = [];
const unexpectedRequests = [];
const files = [];
const captures = [];
const status = {
  agent_online: true, board_online: true, board_name: '界面预览（模拟设备）',
  current_model: 'helmet', current_video_source: '',
  available_models: [
    { id: 'helmet', label: '安全帽检测' }, { id: 'fall', label: '跌倒检测' },
    { id: 'roadside', label: '道路巡检' }, { id: 'smoke', label: '吸烟与烟雾检测' },
    { id: 'danger', label: '危险行为检测' },
  ],
  model_status: { running: false }, navigation_running: false, mapping_running: false,
  cpu_percent: 24, memory_percent: 42, gpu_percent: 12,
  last_heartbeat: new Date().toISOString(),
  battery_status: { available: true, percentage: 82, voltage: 25.1 },
  motion_state: { armed: false, mode: 'dry_run', require_manual_arm: true,
    manual_override: false, nav_lockout: false, cruise_active: false },
};

try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch(process.env.SCREENSHOT_BROWSER_CHANNEL
    ? { channel: process.env.SCREENSHOT_BROWSER_CHANNEL } : {});
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce', colorScheme: 'light',
  });
  await context.addInitScript(() => {
    localStorage.setItem('dashboard_token', 'documentation-preview-only');
    localStorage.setItem('app-theme', 'light');
  });
  await context.routeWebSocket(/.*/, socket => {
    if (socket.url().includes('/ws/status')) socket.send(JSON.stringify(status));
    // No connectToServer call: all WebSocket traffic terminates here.
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    // Keep captures reproducible offline using the frontend's system font fallbacks.
    if (url.origin === 'https://fonts.googleapis.com' && request.resourceType() === 'stylesheet') {
      await route.fulfill({ contentType: 'text/css', body: '' });
      return;
    }
    if (url.origin !== new URL(origin).origin) {
      unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname.startsWith('/api/stream/')) {
      await route.fulfill({ status: 503, body: 'Documentation preview: no camera connected' });
      return;
    }
    if (request.method() !== 'GET') {
      unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      await route.abort();
      return;
    }
    const payload = url.pathname === '/api/system/status' ? status
      : ['/api/maps', '/api/media/gallery', '/api/capture/gallery'].includes(url.pathname) ? { items: [] }
      : url.pathname === '/api/camera/status' ? { enabled: false, connected: false }
      : url.pathname === '/api/media/status' ? { enabled: true, recording_running: false }
      : url.pathname === '/api/capture/status' ? { enabled: true, running: false, frames_saved: 0, storage_free_gb: 128 }
      : {};
    await route.fulfill({ json: payload });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  async function capture(name, hash, selector, tab, navigate = true) {
    console.log(`Rendering ${name}`);
    if (page.viewportSize().width <= 760) await page.setViewportSize({ width: 390, height: 844 });
    if (navigate) await page.goto(`${origin}#${hash}`);
    if (tab) await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: tab, exact: true }).click();
    await page.locator(selector).waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    // Allow theme transitions and video fallback retries to settle.
    await page.waitForTimeout(2200);
    // A full-height viewport keeps fixed navigation at the bottom of the
    // documentation image rather than across the middle of a long page.
    if (page.viewportSize().width <= 760) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: 390, height });
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
    await page.screenshot({ path: fileURLToPath(new URL(name, output)), fullPage: true, animations: 'disabled', timeout: 15000 });
    files.push(name);
    captures.push({ file: name, viewport: page.viewportSize() });
    console.log(`Saved ${name}`);
  }
  await capture('desktop-live-light.png', 'live', '.dashboard-workspace');
  await capture('desktop-algorithms-light.png', 'algorithms', '#section-algorithms');
  await page.getByRole('combobox', { name: '外观', exact: true }).selectOption('dark');
  await capture('desktop-algorithms-dark.png', 'algorithms', '#section-algorithms');
  await page.getByRole('combobox', { name: '外观', exact: true }).selectOption('light');
  await page.setViewportSize({ width: 390, height: 1280 });
  await capture('mobile-capture-light.png', 'live', '.mobile-app');
  await capture('mobile-monitor-light.png', 'live', '.mobile-monitor-page', '监控');
  await capture('mobile-archive-light.png', 'live', '.mobile-archive-page', '记录');
  await page.getByRole('combobox', { name: '外观', exact: true }).selectOption('dark');
  await capture('mobile-capture-dark.png', 'live', '.mobile-capture-page', '采集');
  await page.getByRole('combobox', { name: '外观', exact: true }).selectOption('light');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await capture('mobile-login-light.png', 'live', '.mobile-auth', undefined, false);
  assert.deepEqual(errors, [], 'Browser page errors');
  assert.deepEqual(unexpectedRequests, [], 'Unexpected external or device mutation requests');
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const capturedAt = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  await writeFile(new URL('manifest.json', output), JSON.stringify({
    source_commit: source, captured_at: `${capturedAt} Asia/Shanghai`,
    data_source: 'Simulated HTTP/WebSocket responses; no robot, camera, map or live measurements.',
    browser: browser.version(),
    fonts: 'System font fallbacks; remote Google Fonts stylesheet disabled.',
    desktop_viewport: [1440, 1000], mobile_width: 390, captures, files,
  }, null, 2) + '\n');
  console.log(`Captured ${files.length} frontend previews; no page errors, horizontal overflow or device mutations.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await server.close();
}
