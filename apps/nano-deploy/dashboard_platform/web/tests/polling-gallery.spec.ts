import { test, expect, type Page } from "@playwright/test";

const capture = { enabled: true, running: false, frames_saved: 7, storage_free_gb: 128, stream_mode: "visible_raw", scene: "测试采集" };
const group = (index: number) => ({ group: `group-${index}`, scene: `场景${index}`, stream_mode: "visible_raw", frames_saved: 1, manifest_frames: 1, missing_frames: 0, total_size_bytes: 1024, integrity_ok: true, manifest_name: `group-${index}.csv` });
const firstPage = Array.from({ length: 20 }, (_, i) => group(i + 1));

async function device(page: Page) {
  const mutations: string[] = [];
  const status = { agent_online: true, board_online: true, model_status: { running: false }, available_models: [] };
  await page.addInitScript(() => {
    localStorage.setItem("dashboard_token", "test-token");
    const requests: { path: string; active: boolean; aborted: boolean }[] = [];
    Object.assign(window, { observedReads: requests });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
      if (!/^\/api\/((camera|capture|navigation)\/status|capture\/gallery)$/.test(path)) return original(input, init);
      const read = { path, active: true, aborted: false };
      requests.push(read);
      init?.signal?.addEventListener("abort", () => { read.aborted = true; read.active = false; }, { once: true });
      try { return await original(input, init); } finally { read.active = false; }
    };
  });
  await page.routeWebSocket(/\/ws\//, (socket) => { if (socket.url().includes("/ws/status")) socket.send(JSON.stringify(status)); });
  // These checks simulate every endpoint, including capture stop and deletion.
  await page.route("**/api/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.startsWith("/api/stream/")) { await route.fulfill({ status: 409, body: "test video disabled" }); return; }
    if (req.method() !== "GET") mutations.push(path);
    const payload = path === "/api/system/status" ? status
      : path === "/api/capture/status" || path === "/api/capture/stop" ? capture
      : path === "/api/capture/gallery" ? { items: firstPage }
      : path === "/api/camera/status" ? { enabled: true, connected: false }
      : path === "/api/navigation/status" ? { navigation_running: true, goal_status: "test-idle" }
      : path === "/api/maps" || path === "/api/media/gallery" ? { items: [] } : {};
    await route.fulfill({ json: payload });
  });
  return { mutations };
}

async function reads(page: Page, path: string) {
  return page.evaluate((selected) => (window as unknown as { observedReads: { path: string; active: boolean; aborted: boolean }[] }).observedReads.filter((read) => read.path === selected), path);
}

async function mobile(page: Page, archive = false) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("小车在线", { exact: true })).toBeVisible();
  if (archive) {
    await page.getByRole("button", { name: "记录", exact: true }).click();
    await expect(page.getByRole("button", { name: /场景20.*点击查看全部图片/ })).toBeVisible();
  }
}

for (const isMobile of [false, true]) {
  test(`${isMobile ? "mobile" : "desktop"} waits for a slow camera read before scheduling the next one`, async ({ page }) => {
    await page.clock.install();
    const hardware = await device(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/camera/status", async (route) => { await gate; await route.fulfill({ json: { enabled: true, connected: false } }).catch(() => undefined); });
    if (isMobile) await mobile(page); else await page.goto("/#live");
    await expect.poll(async () => (await reads(page, "/api/camera/status")).filter((r) => r.active).length).toBe(1);
    const initial = (await reads(page, "/api/camera/status")).length;
    await page.clock.fastForward(6000);
    expect((await reads(page, "/api/camera/status")).length).toBe(initial);
    release();
    await expect.poll(async () => (await reads(page, "/api/camera/status")).filter((r) => r.active).length).toBe(0);
    await page.clock.fastForward(5001);
    await expect.poll(async () => (await reads(page, "/api/camera/status")).length).toBe(initial + 1);
    expect(hardware.mutations).toEqual([]);
  });
}

test("a timed out capture status request recovers without accumulating reads or keeping its warning", async ({ page }) => {
  await page.clock.install();
  await device(page);
  let stalled = false, recovered = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/capture/status", async (route) => {
    if (stalled) await gate;
    await route.fulfill({ json: { ...capture, frames_saved: recovered ? 12 : 7 } }).catch(() => undefined);
  });
  await mobile(page);
  await expect(page.locator(".mobile-capture-counter strong")).toHaveText("7");
  stalled = true;
  await page.clock.fastForward(1001);
  await expect.poll(async () => (await reads(page, "/api/capture/status")).filter((r) => r.active).length).toBe(1);
  const count = (await reads(page, "/api/capture/status")).length;
  await page.clock.fastForward(9000);
  expect((await reads(page, "/api/capture/status")).length).toBe(count);
  await page.clock.fastForward(1100);
  await expect(page.getByRole("status")).toContainText("状态查询超时");
  await expect.poll(async () => (await reads(page, "/api/capture/status")).filter((r) => r.active).length).toBe(0);
  stalled = false; recovered = true; release();
  await page.clock.fastForward(1001);
  await expect(page.locator(".mobile-capture-counter strong")).toHaveText("12");
  await expect(page.getByText("状态查询超时，请重试。", { exact: false })).toHaveCount(0);
});

test("leaving navigation cancels a pending status read and returning starts a fresh read", async ({ page }) => {
  await page.clock.install();
  const hardware = await device(page);
  let delayed = true, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/navigation/status", async (route) => {
    const wasDelayed = delayed;
    if (wasDelayed) await gate;
    await route.fulfill({ json: { navigation_running: true, goal_status: wasDelayed ? "old-goal" : "fresh-goal" } }).catch(() => undefined);
  });
  await page.goto("/#navigation");
  await expect.poll(async () => (await reads(page, "/api/navigation/status")).some((r) => r.active)).toBe(true);
  await page.locator(".sidebar-navigation").getByRole("button", { name: /^实时监控/ }).click();
  await expect.poll(async () => (await reads(page, "/api/navigation/status")).some((r) => r.active)).toBe(false);
  const count = (await reads(page, "/api/navigation/status")).length;
  await page.clock.fastForward(5000);
  expect((await reads(page, "/api/navigation/status")).length).toBe(count);
  delayed = false; release();
  await page.locator(".sidebar-navigation").getByRole("button", { name: /^建图导航/ }).click();
  await expect(page.getByText("fresh-goal", { exact: true })).toBeVisible();
  await expect(page.getByText("old-goal", { exact: true })).toHaveCount(0);
  expect(hardware.mutations).toEqual([]);
});

test("a confirmed capture stop cannot be overwritten by an older status read", async ({ page }) => {
  await page.clock.install();
  const hardware = await device(page);
  let stalled = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/capture/status", async (route) => {
    if (stalled) await gate;
    await route.fulfill({ json: { ...capture, running: true, ready: true } }).catch(() => undefined);
  });
  await mobile(page);
  await expect(page.getByRole("button", { name: "停止采集", exact: true })).toBeEnabled();
  stalled = true;
  await page.clock.fastForward(1001);
  await expect.poll(async () => (await reads(page, "/api/capture/status")).some((r) => r.active)).toBe(true);
  await page.getByRole("button", { name: "停止采集", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止采集", exact: true })).toHaveCount(0);
  await expect.poll(async () => (await reads(page, "/api/capture/status")).some((r) => r.active)).toBe(false);
  release();
  await expect(page.getByRole("button", { name: /开始采集 可见光/ })).toBeEnabled();
  expect(hardware.mutations).toEqual(["/api/capture/stop"]);
});

test("mobile pagination keeps older groups through automatic refresh and manual refresh returns to the newest page", async ({ page }) => {
  await page.clock.install();
  await device(page);
  const pages: number[] = [];
  await page.route("**/api/capture/gallery?**", async (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get("page"));
    pages.push(number);
    await route.fulfill({ json: { items: number === 1 ? firstPage : [group(20), group(21)] } });
  });
  await mobile(page, true);
  await page.getByRole("button", { name: "加载更多采集记录", exact: true }).click();
  await expect(page.getByRole("button", { name: /场景21.*点击查看全部图片/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /场景20.*点击查看全部图片/ })).toHaveCount(1);
  const count = pages.length;
  await page.clock.fastForward(15000);
  expect(pages.length).toBe(count);
  await expect(page.getByRole("button", { name: /场景21.*点击查看全部图片/ })).toBeVisible();
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(page.getByRole("button", { name: /场景21.*点击查看全部图片/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加载更多采集记录", exact: true })).toBeEnabled();
  expect(pages.at(-1)).toBe(1);
});

test("mobile pagination errors preserve the list and retry the failed page", async ({ page }) => {
  await device(page);
  let attempts = 0;
  await page.route("**/api/capture/gallery?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("page") === "1") { await route.fulfill({ json: { items: firstPage } }); return; }
    attempts++;
    await route.fulfill(attempts === 1 ? { status: 503, json: { detail: "采集记录暂不可读" } } : { json: { items: [group(21)] } });
  });
  await mobile(page, true);
  await page.getByRole("button", { name: "加载更多采集记录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("采集记录暂不可读");
  await expect(page.getByRole("button", { name: /场景20.*点击查看全部图片/ })).toBeVisible();
  await page.getByRole("button", { name: "重试加载采集记录", exact: true }).click();
  await expect(page.getByRole("button", { name: /场景21.*点击查看全部图片/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("deleting a capture group invalidates a pending background refresh", async ({ page }) => {
  await page.clock.install();
  const hardware = await device(page);
  let delayed = false, removed = false, release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/capture/gallery?**", async (route) => {
    const wasDelayed = delayed && !removed;
    if (wasDelayed) await gate;
    await route.fulfill({ json: { items: wasDelayed ? firstPage : firstPage.filter((item) => !removed || item.group !== "group-3") } }).catch(() => undefined);
  });
  await page.route("**/api/capture/gallery/group-3", async (route) => { removed = true; hardware.mutations.push("delete-group-3"); await route.fulfill({ json: { ok: true } }); });
  await mobile(page, true);
  delayed = true;
  await page.clock.fastForward(5001);
  await expect.poll(async () => (await reads(page, "/api/capture/gallery")).filter((r) => r.active).length).toBe(1);
  const backgroundIndex = (await reads(page, "/api/capture/gallery")).length - 1;
  await page.getByRole("button", { name: "删除 场景3", exact: true }).click();
  await expect(page.getByRole("button", { name: /场景3.*点击查看全部图片/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "刷新状态", exact: true })).toBeEnabled();
  expect((await reads(page, "/api/capture/gallery"))[backgroundIndex].aborted).toBe(true);
  release();
  await expect(page.getByRole("button", { name: /场景3.*点击查看全部图片/ })).toHaveCount(0);
  expect(hardware.mutations).toEqual(["delete-group-3"]);
});

test("long capture names keep mobile cards and delete buttons within the screen", async ({ page }) => {
  const hardware = await device(page);
  await page.route("**/api/capture/gallery?**", async (route) => {
    await route.fulfill({ json: { items: [{ ...group(20), scene: "学院楼固定起点_".repeat(12), manifest_name: `capture_${"20261117_学院楼_".repeat(15)}.csv`, latest_frame_name: "frame.jpg" }] } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.locator(".mobile-history-item")).toHaveCount(1);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.locator(".mobile-archive-page > *, .mobile-history-list, .mobile-history-item, .mobile-history-delete").evaluateAll((nodes) => nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map((node) => node.className))).toEqual([]);
  }
  expect(hardware.mutations).toEqual([]);
});
