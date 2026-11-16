import { test, expect, type Page, type Route } from "@playwright/test";

const recording = (index: number) => ({ storage_kind: "recording", media_type: "video", filename: `recording-${index}.mp4`, created_at: "2026-11-16T12:00:00Z", size_bytes: 1024 });
const event = (index: number) => ({ storage_kind: "event", media_type: "image", filename: `20261116_120000_event-${index}.jpg`, created_at: "2026-11-16T12:00:00Z", size_bytes: 1024 });
const group = (id: string) => ({ group: id, scene: `场景${id}`, stream_mode: "visible_raw", frames_saved: 1, manifest_frames: 1, missing_frames: 0, total_size_bytes: 1024, integrity_ok: true, manifest_name: `${id}.csv`, latest_frame_name: `${id}.jpg` });
const frame = (id: string) => ({ name: `${id}.jpg`, stream_mode: "visible_raw", size_bytes: 1024 });
const firstPage = Array.from({ length: 20 }, (_, index) => recording(index + 1));

async function mockDevice(page: Page) {
  const mutations: string[] = [];
  const status = { agent_online: true, board_online: true, model_status: { running: false }, available_models: [] };
  await page.addInitScript(() => localStorage.setItem("dashboard_token", "test-token"));
  await page.routeWebSocket(/\/ws\//, (socket) => { if (socket.url().includes("/ws/status")) socket.send(JSON.stringify(status)); });
  // Every endpoint, including snapshot and file requests, is simulated.
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith("/api/stream/")) { await route.fulfill({ status: 409, body: "test video disabled" }); return; }
    if (request.method() !== "GET") mutations.push(path);
    if (path.endsWith(".jpg")) {
      await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=", "base64") });
      return;
    }
    const payload = path === "/api/system/status" ? status
      : path === "/api/media/status" ? { enabled: true, recording_running: false }
      : path === "/api/media/gallery" ? { items: firstPage }
      : path === "/api/maps" ? { items: [] }
      : path === "/api/camera/status" ? { enabled: false, connected: false }
      : path === "/api/capture/status" ? { enabled: true, running: false, frames_saved: 0, storage_free_gb: 128 }
      : path === "/api/capture/gallery" ? { items: [group("A"), group("B")] }
      : path.endsWith("/frames") ? { items: [frame("B")] } : {};
    await route.fulfill({ json: payload });
  });
  return { mutations };
}

async function mediaPage(page: Page) {
  await page.goto("/#perception");
  await expect(page.getByText("recording-20.mp4", { exact: true })).toBeVisible();
}

test("all loaded files and events are reachable; subsequent pages append without duplicates", async ({ page }) => {
  const hardware = await mockDevice(page);
  const pages: number[] = [];
  await page.route("**/api/media/gallery?**", async (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get("page"));
    pages.push(number);
    await route.fulfill({ json: { items: number === 1 ? firstPage : [recording(20), ...Array.from({ length: 17 }, (_, i) => event(i + 1))] } });
  });
  await mediaPage(page);
  await expect(page.getByRole("link", { name: "打开", exact: true })).toHaveCount(20);
  await page.getByRole("button", { name: "加载更多记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "加载更多记录", exact: true })).toHaveCount(0);
  await expect(page.getByText("recording-20.mp4", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "检测记录", exact: true }).click();
  await expect(page.getByText("event-17", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看", exact: true })).toHaveCount(17);
  expect(pages).toContain(2);
  expect(hardware.mutations).toEqual([]);
});

test("a failed next page preserves loaded files and retries the same page", async ({ page }) => {
  await mockDevice(page);
  let attempts = 0;
  await page.route("**/api/media/gallery?**", async (route) => {
    const number = Number(new URL(route.request().url()).searchParams.get("page"));
    if (number === 1) { await route.fulfill({ json: { items: firstPage } }); return; }
    attempts++;
    await route.fulfill(attempts === 1 ? { status: 503, json: { detail: "暂时无法读取记录" } } : { json: { items: [recording(21)] } });
  });
  await mediaPage(page);
  await page.getByRole("button", { name: "加载更多记录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("暂时无法读取记录");
  await expect(page.getByText("recording-20.mp4", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试加载记录", exact: true }).click();
  await expect(page.getByText("recording-21.mp4", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("a refresh after taking a snapshot cancels an older pending page", async ({ page }) => {
  const hardware = await mockDevice(page);
  let release!: () => void, started = false, finished = false, refreshed = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/media/gallery?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("page") === "2") {
      started = true;
      await gate;
      await route.fulfill({ json: { items: [event(99)] } }).catch(() => undefined);
      finished = true;
    } else await route.fulfill({ json: { items: refreshed ? [recording(100)] : firstPage } });
  });
  await mediaPage(page);
  await page.getByRole("button", { name: "加载更多记录", exact: true }).click();
  await expect.poll(() => started).toBe(true);
  refreshed = true;
  await page.getByRole("button", { name: "拍照", exact: true }).click();
  await expect(page.getByText("recording-100.mp4", { exact: true })).toBeVisible();
  release();
  await expect.poll(() => finished).toBe(true);
  await page.getByRole("button", { name: "检测记录", exact: true }).click();
  await expect(page.getByText("event-99", { exact: true })).toHaveCount(0);
  expect(hardware.mutations).toEqual(["/api/media/snapshot"]);
});

test("initial list failure has a retry and is not presented as an empty gallery", async ({ page }) => {
  await mockDevice(page);
  let failed = true;
  await page.route("**/api/media/gallery?**", async (route) => {
    await route.fulfill(failed ? { status: 503, json: { detail: "记录服务不可用" } } : { json: { items: [recording(42)] } });
  });
  await page.goto("/#perception");
  await expect(page.getByRole("alert")).toContainText("记录服务不可用");
  await expect(page.getByText("当前已加载记录中没有录像或照片。", { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "重试加载记录", exact: true }).click();
  await expect(page.getByText("recording-42.mp4", { exact: true })).toBeVisible();
});

async function captureArchive(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("button", { name: /场景A.*点击查看全部图片/ })).toBeVisible();
}

test("switching capture groups cannot replace the new group's images with a late response", async ({ page }) => {
  const hardware = await mockDevice(page);
  let release!: () => void, started = false, finished = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/capture/gallery/A/frames", async (route) => {
    started = true;
    await gate;
    await route.fulfill({ json: { items: [frame("A")] } }).catch(() => undefined);
    finished = true;
  });
  await captureArchive(page);
  await page.getByRole("button", { name: /场景A.*点击查看全部图片/ }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "返回采集记录", exact: true }).click();
  await page.getByRole("button", { name: /场景B.*点击查看全部图片/ }).click();
  await expect(page.locator(".mobile-viewer-image-card img")).toHaveAttribute("src", /\/B\/frames\/B.jpg/);
  release();
  await expect.poll(() => finished).toBe(true);
  await expect(page.locator(".mobile-viewer-image-card img")).toHaveAttribute("src", /\/B\/frames\/B.jpg/);
  expect(hardware.mutations).toEqual([]);
});

test("capture image errors are retryable and distinct from empty data", async ({ page }) => {
  await mockDevice(page);
  let failed = true;
  await page.route("**/api/capture/gallery/A/frames", async (route) => {
    await route.fulfill(failed ? { status: 503, json: { detail: "无法读取图片" } } : { json: { items: [frame("A")] } });
  });
  await captureArchive(page);
  await page.getByRole("button", { name: /场景A.*点击查看全部图片/ }).click();
  await expect(page.getByRole("alert")).toContainText("无法读取图片");
  await expect(page.getByText("这条记录没有可查看的图片", { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "重试加载图片", exact: true }).click();
  await expect(page.locator(".mobile-viewer-image-card img")).toHaveAttribute("src", /\/A\/frames\/A.jpg/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("leaving the capture archive cancels its image request and returning shows the list", async ({ page }) => {
  await mockDevice(page);
  let release!: () => void, started = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/capture/gallery/A/frames", async (route: Route) => {
    started = true;
    await gate;
    await route.fulfill({ json: { items: [frame("A")] } }).catch(() => undefined);
  });
  await captureArchive(page);
  await page.getByRole("button", { name: /场景A.*点击查看全部图片/ }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "采集", exact: true }).click();
  release();
  await page.getByRole("button", { name: "记录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "历史采集", exact: true })).toBeVisible();
  await expect(page.locator(".mobile-gallery-viewer")).toHaveCount(0);
});
