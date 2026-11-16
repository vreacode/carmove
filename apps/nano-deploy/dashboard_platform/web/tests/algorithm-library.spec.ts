import { test, expect, type Page } from "@playwright/test";

const modelIds = ["roadside", "helmet", "fall", "smoke", "danger"];
const initialStatus = {
  agent_online: true, board_online: true,
  current_model: "helmet", current_video_source: "rtsp://example.invalid/video",
  current_video_mode: "annotated",
  available_models: modelIds.map((id) => ({ id, label: id, weight: `${id}.pt` })),
  model_status: { running: true, model_id: "helmet" },
  navigation_running: false, mapping_running: false,
};

// All device HTTP and WebSocket traffic is intercepted. These checks cannot start hardware tasks.
async function mockDevice(page: Page, overrides = {}) {
  const status = { ...initialStatus, ...overrides };
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  const statusSockets: { send: (payload: string) => void }[] = [];
  await page.addInitScript(() => localStorage.setItem("dashboard_token", "ui-test-token"));
  await page.routeWebSocket(/\/ws\//, (socket) => {
    if (socket.url().includes("/ws/status")) {
      statusSockets.push(socket);
      socket.send(JSON.stringify(status));
    }
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && !path.startsWith("/api/stream/")) mutations.push({ path, body: request.postDataJSON() ?? {} });
    let payload: unknown = {};
    if (path === "/api/system/status") payload = status;
    else if (path === "/api/maps" || path === "/api/media/gallery") payload = { items: [] };
    else if (path === "/api/camera/status") payload = { enabled: true, connected: true };
    else if (path.startsWith("/api/stream/")) { await route.fulfill({ status: 409, body: "test video disabled" }); return; }
    await route.fulfill({ json: payload });
  });
  return { status, mutations, pushStatus: async () => {
    await expect.poll(() => statusSockets.length).toBeGreaterThan(0);
    statusSockets.forEach((socket) => socket.send(JSON.stringify(status)));
  } };
}

test("catalog deep link, real model entries, search and empty state", async ({ page }) => {
  await mockDevice(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#algorithms");
  await expect(page.getByRole("heading", { name: "算法库", exact: true })).toBeVisible();
  await expect(page.locator("#section-algorithms").getByRole("button", { name: /运行中/ })).toHaveCount(1);
  await page.getByRole("button", { name: "视觉识别", exact: true }).click();
  await expect(page.getByText("5 项匹配", { exact: false })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索算法" }).fill("smoke");
  await expect(page.getByRole("heading", { name: "吸烟与烟雾检测", exact: true })).toBeVisible();
  await expect(page.getByText("Cigarette / Person / Smoke / Vape 目标框与置信度", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索算法" }).fill("no-such-algorithm");
  await expect(page.getByText("没有匹配的算法")).toBeVisible();
  await expect(page.getByRole("heading", { name: "算法详情" })).toHaveCount(0);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page.getByText("9 项匹配", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.locator(".catalog-counts .animated-number").first()).toHaveAttribute("data-counting", "false");
  await page.screenshot({ path: "test-results/algorithm-library-desktop.png", fullPage: true });
});

test("loading a model preserves selection across live status updates and sends correct restart", async ({ page }) => {
  const device = await mockDevice(page);
  await page.goto("/#algorithms");
  await page.getByRole("button", { name: /^跌倒检测/ }).click();
  await page.getByRole("button", { name: "加载到实时监控", exact: true }).click();
  await expect(page).toHaveURL(/#live$/);
  await device.pushStatus();
  await expect(page.getByRole("combobox", { name: "检测模型", exact: true })).toHaveValue("fall");
  await expect(page.getByText("当前运行 helmet，点击“切换模型”", { exact: false })).toBeVisible();
  expect(device.mutations).toEqual([]);
  await page.getByRole("button", { name: "切换模型", exact: true }).click();
  await expect.poll(() => device.mutations.length).toBe(1);
  expect(device.mutations[0]).toMatchObject({ path: "/api/model/restart", body: { model_id: "fall", annotate: true, source: "rtsp://example.invalid/video" } });
  expect(device.mutations[0].body).not.toHaveProperty("parking_zone");
});

test("opening a mapping or navigation workflow selects config without starting tasks", async ({ page }) => {
  const device = await mockDevice(page);
  await page.goto("/#algorithms");
  await page.getByRole("button", { name: "定位建图", exact: true }).click();
  await page.getByRole("button", { name: /^FAST-LIO2 三维建图/ }).click();
  await page.getByRole("button", { name: "打开建图配置" }).click();
  await expect(page).toHaveURL(/#navigation$/);
  await expect(page.getByRole("button", { name: /FAST-LIO2/ }).first()).toBeVisible();
  await page.goto("/#algorithms");
  await page.getByRole("button", { name: "自主导航", exact: true }).click();
  await page.getByRole("button", { name: "打开导航页面" }).click();
  await expect(page).toHaveURL(/#navigation$/);
  expect(device.mutations).toEqual([]);
});

test("offline or unconfigured models cannot be loaded; unknown configured models are discoverable", async ({ page }) => {
  const device = await mockDevice(page, { agent_online: false, available_models: [] });
  await page.goto("/#algorithms");
  await expect(page.getByRole("button", { name: "加载到实时监控", exact: true })).toBeDisabled();
  await expect(page.getByText("设备状态未连接。", { exact: false })).toBeVisible();
  Object.assign(device.status, { agent_online: true, model_status: { running: false }, available_models: [{ id: "custom", label: "自定义测试模型", weight: "custom.pt" }] });
  await device.pushStatus();
  await expect(page.getByText("设备状态未连接。", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "加载到实时监控", exact: true })).toBeDisabled();
  await page.getByRole("searchbox", { name: "搜索算法" }).fill("自定义");
  await expect(page.getByRole("heading", { name: "自定义测试模型", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "加载到实时监控", exact: true })).toBeEnabled();
});

test("tablet layout fits and theme tokens remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await mockDevice(page);
  await page.goto("/#algorithms");
  await page.getByRole("searchbox", { name: "搜索算法" }).fill("helmet");
  await expect(page.getByRole("heading", { name: "算法详情" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.dataset.theme = "dark");
  await page.screenshot({ path: "test-results/algorithm-library-tablet-dark.png", fullPage: true });
});
