import { test, expect, type Page } from "@playwright/test";

async function device(page: Page, maps: string[] = []) {
  const status = { agent_online: true, board_online: true, current_model: "helmet", current_video_source: "rtsp://example.invalid/video",
    available_models: [{ id: "helmet", label: "安全帽", weight: "helmet.pt" }], model_status: { running: true, model_id: "helmet" }, navigation_running: true };
  const mutations: string[] = [];
  await page.addInitScript(() => localStorage.setItem("dashboard_token", "test-token"));
  await page.routeWebSocket(/\/ws\//, (socket) => { if (socket.url().includes("/ws/status")) socket.send(JSON.stringify(status)); });
  await page.route("**/api/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== "GET" && !path.startsWith("/api/stream/")) mutations.push(path);
    const payload = path === "/api/system/status" ? status : path === "/api/maps" ? { items: maps.map((name) => ({ name, updated_at: "2026-11-16T00:00:00Z" })) }
      : path === "/api/media/gallery" ? { items: [] } : path === "/api/navigation/status" ? { navigation_running: true } : {};
    await route.fulfill({ json: payload });
  });
  return { mutations };
}

async function mockPeers(page: Page) {
  await page.addInitScript(() => {
    const records: { id: number; closed: boolean; remote: number; stats: number }[] = [];
    const callbacks = new Map<number, { video: HTMLVideoElement; callback: VideoFrameRequestCallback }>();
    let callbackId = 0;
    Object.assign(window, { testPeers: records, emitTestFrames: (mode: string) => {
      for (const [id, frame] of [...callbacks]) {
        if (frame.video.closest(".console-feed")?.getAttribute("data-channel") !== mode) continue;
        callbacks.delete(id);
        frame.callback(performance.now(), { width: 960, height: 540 } as VideoFrameCallbackMetadata);
      }
    } });
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) { callbacks.set(++callbackId, { video: this, callback }); return callbackId; };
    HTMLVideoElement.prototype.cancelVideoFrameCallback = (id) => { callbacks.delete(id); };
    class Peer {
      record = { id: records.length, closed: false, remote: 0, stats: 0 };
      connectionState = "new";
      ontrack: ((event: unknown) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      constructor() { records.push(this.record); }
      addTransceiver() {}
      async createOffer() { return { sdp: String(this.record.id), type: "offer" }; }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.record.remote++; this.connectionState = "connected";
        this.onconnectionstatechange?.(); this.ontrack?.({ streams: [new MediaStream()] });
      }
      async getStats() { this.record.stats++; return new Map(); }
      close() { this.record.closed = true; this.connectionState = "closed"; }
    }
    Object.assign(window, { RTCPeerConnection: Peer });
  });
}

test("late video offers cannot revive retired peers; transport connection alone is not a live picture", async ({ page }) => {
  await page.clock.install();
  const hardware = await device(page);
  await mockPeers(page);
  let release!: () => void;
  const oldReply = new Promise<void>((resolve) => { release = resolve; });
  let oldId = -1;
  await page.route("**/api/stream/webrtc-offer", async (route) => {
    const body = route.request().postDataJSON();
    if (body.stream_mode === "visible_raw") { oldId = Number(body.sdp); await oldReply; }
    await route.fulfill({ json: { type: "answer", sdp: "test-answer" } }).catch(() => undefined);
  });
  await page.goto("/#live");
  await expect.poll(() => oldId).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: "检测结果", exact: true }).click();
  const feed = page.locator('.console-feed[data-channel="annotated"]');
  await expect.poll(() => page.evaluate(() => (window as any).testPeers.filter((peer: any) => peer.remote > 0).length)).toBeGreaterThan(0);
  await expect(feed.locator(".console-feed-status")).not.toHaveAttribute("data-state", "connected");
  release();
  await page.evaluate(() => (window as any).emitTestFrames("annotated"));
  await expect(feed.locator(".console-feed-status")).toHaveAttribute("data-state", "connected");
  await page.clock.fastForward(1200);
  const retired = await page.evaluate((id) => (window as any).testPeers[id], oldId);
  expect(retired).toMatchObject({ closed: true, remote: 0, stats: 0 });
  expect(hardware.mutations).toEqual([]);
});

test("failed RTC actually renders HTTP fallback; retry and fullscreen also work for the fallback picture", async ({ page }) => {
  const hardware = await device(page);
  await mockPeers(page);
  await page.route("**/api/stream/webrtc-offer", (route) => route.fulfill({ status: 503, json: { detail: "video not ready" } }));
  let imageAvailable = false;
  await page.route("**/api/stream/fallback?**", (route) => imageAvailable
    ? route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2cAAAAASUVORK5CYII=", "base64") })
    : route.fulfill({ status: 503 }));
  await page.goto("/#live");
  await page.getByRole("button", { name: "检测结果", exact: true }).click();
  const feed = page.locator('.console-feed[data-channel="annotated"]');
  await expect(feed.locator("img")).toHaveCount(1);
  await expect(feed.locator("video")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新连接检测结果", exact: true })).toBeVisible();
  imageAvailable = true;
  await page.getByRole("button", { name: "重新连接检测结果", exact: true }).click();
  await expect(feed.getByAltText("检测结果实时画面")).toBeVisible();
  await expect(feed.locator(".console-feed-status")).toHaveAttribute("data-state", "connected");
  await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = async function () { (window as any).fullscreenTarget = this.className; }; });
  await page.getByRole("button", { name: "全屏查看检测结果", exact: true }).click();
  expect(await page.evaluate(() => (window as any).fullscreenTarget)).toContain("console-video-frame");
  expect(hardware.mutations).toEqual([]);
});

const pgm = "P2\n4 4\n255\n" + Array(16).fill("255").join(" ");
const metadata = (name: string) => ({ name, resolution: 0.2, origin: [0, 0, 0], width: 4, height: 4 });

test("map selection is atomic, clears old goals and ignores an earlier delayed map", async ({ page }) => {
  const hardware = await device(page, ["map_a", "map_b", "map_c"]);
  let release!: () => void;
  let startedB = false;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/api\/maps\/map_[abc](\/pgm)?$/, async (route) => {
    const path = new URL(route.request().url()).pathname, name = path.split("/")[3];
    if (path.endsWith("/pgm")) {
      if (name === "map_b") { startedB = true; await delayed; }
      await route.fulfill({ contentType: "image/x-portable-graymap", body: pgm }).catch(() => undefined);
    } else await route.fulfill({ json: metadata(name) });
  });
  await page.goto("/#navigation");
  await expect(page.getByAltText("map map_a", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "设置目标", exact: true }).click();
  await page.getByAltText("map map_a", { exact: true }).click();
  await expect(page.getByRole("button", { name: "发送目标", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "选择地图 map_b", exact: true }).click();
  await expect.poll(() => startedB).toBe(true);
  await expect(page.getByRole("button", { name: "发送目标", exact: true })).toBeDisabled();
  await expect(page.getByAltText("map map_a", { exact: true })).toHaveCount(0);
  await expect(page.getByAltText("map map_b", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "选择地图 map_c", exact: true }).click();
  await expect(page.getByAltText("map map_c", { exact: true })).toBeVisible();
  release();
  await expect(page.getByAltText("map map_b", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送目标", exact: true })).toBeDisabled();
  expect(hardware.mutations).toEqual([]);
});

test("map errors have a working retry; navigation failures show a readable dismissible message", async ({ page }) => {
  const hardware = await device(page, ["map_a"]);
  let imageAvailable = false;
  await page.route("**/api/maps/map_a", (route) => route.fulfill({ json: metadata("map_a") }));
  await page.route("**/api/maps/map_a/pgm", (route) => imageAvailable ? route.fulfill({ body: pgm }) : route.fulfill({ status: 503 }));
  await page.goto("/#navigation");
  await expect(page.getByRole("alert")).toContainText("地图加载失败");
  imageAvailable = true;
  await page.getByRole("button", { name: "重新加载地图", exact: true }).click();
  await expect(page.getByAltText("map map_a", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.route("**/api/preset/run", (route) => route.fulfill({ status: 409, json: { detail: "设备忙，请稍后重试" } }));
  await page.getByRole("button", { name: "停止导航", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("设备忙，请稍后重试");
  await page.getByRole("button", { name: "关闭错误提示", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(hardware.mutations).toEqual([]); // Specific mocked error route never reaches the generic device handler.
});

test("PGM previews preserve leading black and whitespace pixels and decode 16-bit or commented maps", async ({ page }) => {
  await device(page);
  await page.goto("/#navigation");
  const result = await page.evaluate(async () => {
    const { parsePgm } = await import("/src/mapImage.ts");
    const binary = (header: string, pixels: number[]) => new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
    const a = parsePgm(binary("P5\n2 2\n255\n", [0, 10, 32, 255]));
    const b = parsePgm(binary("P5\r\n2 2\r\n65535\r\n", [0, 0, 64, 0, 128, 0, 255, 255]));
    const c = parsePgm(new TextEncoder().encode("P2\n# test\n2 2\n255\n0 # black\n10 32 255\n"));
    let truncatedRejected = false;
    try { parsePgm(binary("P5\n2 2\n255\n", [0, 10])); } catch { truncatedRejected = true; }
    return { a: [...a.data], b: [...b.data], c: [...c.data], truncatedRejected };
  });
  expect(result).toEqual({ a: [0, 10, 32, 255], b: [0, 64, 128, 255], c: [0, 10, 32, 255], truncatedRejected: true });
});
