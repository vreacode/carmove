import { test, expect, type Page } from '@playwright/test';

async function preview(page: Page) {
  const writes: string[] = [];
  const status = { agent_online: true, board_online: true, model_status: { running: false },
    available_models: [], cpu_percent: 24, memory_percent: 42,
    motion_state: { armed: false, mode: 'dry_run', cruise_active: false, nav_lockout: false } };
  await page.addInitScript(() => localStorage.setItem('dashboard_token', 'mobile-preview'));
  await page.routeWebSocket(/.*/, socket => {
    if (socket.url().includes('/ws/status')) socket.send(JSON.stringify(status));
  });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.startsWith('/api/stream/')) return route.fulfill({ status: 503, body: 'No camera in preview' });
    if (req.method() !== 'GET') writes.push(path);
    await route.fulfill({ json: path === '/api/system/status' ? status
      : path === '/api/capture/gallery' ? { items: [] }
      : path === '/api/capture/status' ? { enabled: true, running: false, storage_free_gb: 128 }
      : path === '/api/camera/status' ? { enabled: false, connected: false } : {} });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  return writes;
}

test('mobile appearance persists and follows system on all three tabs and login', async ({ page }) => {
  const writes = await preview(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const appearance = page.getByRole('combobox', { name: '外观', exact: true });
  await expect(appearance).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await appearance.selectOption('light');
  await page.reload();
  await expect(appearance).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  for (const tab of ['监控', '记录', '采集']) {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: tab, exact: true }).click();
    await expect(appearance).toHaveValue('light');
  }
  await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(appearance).toBeVisible();
  await appearance.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(writes).toEqual([]);
});

test('mobile camera failure shows an honest empty state, hidden failed image and retry', async ({ page }) => {
  const writes = await preview(page);
  await page.goto('/');
  await expect(page.getByText('视频暂不可用', { exact: true })).toBeVisible();
  await expect(page.locator('.mobile-video-card img')).toBeHidden();
  await page.getByRole('button', { name: '重新连接可见光', exact: true }).click();
  await expect(page.getByText('视频暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全屏查看可见光', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('mobile tabs fit narrow and wide phones, with reachable actions above navigation', async ({ page }) => {
  const writes = await preview(page);
  await page.goto('/');
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.getByRole('navigation', { name: '主导航' });
    for (const tab of ['采集', '监控', '记录']) {
      await nav.getByRole('button', { name: tab, exact: true }).click();
      const bounds = await page.locator('.mobile-page').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, scroll: el.scrollWidth, width: el.clientWidth }));
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
      for (const button of await nav.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const lastContent = await page.locator('.mobile-page').boundingBox();
      const navBox = await nav.boundingBox();
      const stopBox = await page.locator('.mobile-emergency-stop').count() ? await page.locator('.mobile-emergency-stop').boundingBox() : null;
      expect(lastContent!.y + lastContent!.height).toBeLessThanOrEqual((stopBox ?? navBox)!.y);
    }
  }
  expect(writes).toEqual([]);
});
