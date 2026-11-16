import { test, expect, type Page } from "@playwright/test";

async function mockDevice(page: Page, missing = false) {
  let heartbeat = Date.parse("2026-11-16T11:00:00Z");
  const status = {
    agent_online: true,
    board_online: true,
    board_name: "Jetson Nano",
    current_model: "helmet",
    current_video_source: "rtsp://example.invalid/video",
    available_models: [
      { id: "helmet", label: "安全帽检测" },
      { id: "fall", label: "跌倒检测" },
    ],
    model_status: { running: false },
    navigation_running: false,
    mapping_running: false,
    motion_state: {
      armed: false,
      mode: "dry_run",
      require_manual_arm: true,
      manual_override: false,
      nav_lockout: false,
      cruise_active: false,
      cruise_steering: "center",
    },
    battery_status: { available: true, percentage: 82, voltage: 25.1 },
    cpu_percent: missing ? null : 64,
    memory_percent: missing ? null : 52.3,
    gpu_percent: missing ? null : 18,
    last_heartbeat: new Date(heartbeat).toISOString(),
  };
  const mutations: string[] = [];
  const sockets: { send: (message: string) => void }[] = [];
  await page.addInitScript(() =>
    localStorage.setItem("dashboard_token", "ui-test-token"),
  );
  await page.routeWebSocket(/\/ws\//, (socket) => {
    if (socket.url().includes("/ws/status")) {
      sockets.push(socket);
      socket.send(JSON.stringify(status));
    }
  });
  // Every device endpoint is intercepted. No hardware task can be started.
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/stream/")) {
      await route.fulfill({ status: 409, body: "test video disabled" });
      return;
    }
    if (route.request().method() !== "GET") mutations.push(path);
    let payload: unknown = {};
    if (path === "/api/system/status") payload = status;
    else if (path === "/api/maps" || path === "/api/media/gallery")
      payload = { items: [] };
    else if (path === "/api/camera/status")
      payload = { enabled: false, connected: false };
    await route.fulfill({ json: payload });
  });
  return {
    mutations,
    status,
    push: async (freshHeartbeat = true) => {
      if (freshHeartbeat)
        status.last_heartbeat = new Date((heartbeat += 1000)).toISOString();
      await expect.poll(() => sockets.length).toBeGreaterThan(0);
      sockets.forEach((socket) => socket.send(JSON.stringify(status)));
    },
  };
}

const cpuNumber = (page: Page) =>
  page.getByLabel("CPU负载", { exact: true }).locator(".animated-number");
const cpuDisplay = (page: Page) =>
  cpuNumber(page).locator(".animated-number-value");

test("numbers count while cards stay still; replay preserves video and model selection", async ({
  page,
}) => {
  const device = await mockDevice(page);
  await page.goto("/#live");
  await expect(cpuNumber(page)).toHaveAttribute("data-counting", "true");
  const initial = Number(await cpuDisplay(page).textContent());
  expect(initial).toBeGreaterThanOrEqual(0);
  expect(initial).toBeLessThan(64);
  const stable = await page.locator(".live-summary").boundingBox();
  const sidebar = await page.locator(".workspace-sidebar").boundingBox();
  await expect(cpuNumber(page)).toHaveAttribute("data-counting", "false");
  await expect(cpuDisplay(page)).toHaveText("64.0");
  expect(await page.locator(".live-summary").boundingBox()).toEqual(stable);
  await page
    .getByRole("combobox", { name: "检测模型", exact: true })
    .selectOption("fall");
  await page
    .locator(".console-feed")
    .first()
    .evaluate((element) =>
      element.setAttribute("data-stream-identity", "same-stream"),
    );
  await page
    .locator(".sidebar-navigation")
    .getByRole("button", { name: /^实时监控/ })
    .click();
  await expect(cpuNumber(page)).toHaveAttribute("data-counting", "true");
  await expect(page.locator(".console-feed").first()).toHaveAttribute(
    "data-stream-identity",
    "same-stream",
  );
  await expect(
    page.getByRole("combobox", { name: "检测模型", exact: true }),
  ).toHaveValue("fall");
  expect(await page.locator(".workspace-sidebar").boundingBox()).toEqual(
    sidebar,
  );
  for (const selector of [
    ".live-summary-card",
    ".live-monitor",
    ".live-control",
  ]) {
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).transform),
    ).toBe("none");
  }
  expect(device.mutations).toEqual([]);
});

test("curves use received samples, deduplicate heartbeat updates and survive workspace switches", async ({
  page,
}) => {
  const device = await mockDevice(page);
  await page.goto("/#live");
  const curve = page
    .getByLabel("CPU负载", { exact: true })
    .locator(".resource-curve");
  await expect(curve).toHaveAttribute("data-samples", "1");
  await expect(curve.locator("path[stroke]")).toHaveCount(0);
  device.status.cpu_percent = 32;
  await device.push();
  await expect(curve).toHaveAttribute("data-samples", "2");
  await expect(curve.locator("path[stroke]")).toHaveCount(1);
  await expect(curve).toHaveAttribute("data-animating", "false");
  const firstPath = await curve.locator("path[stroke]").getAttribute("d");
  device.status.cpu_percent = 47;
  await device.push();
  await expect(curve).toHaveAttribute("data-samples", "3");
  await expect(curve).toHaveAttribute("data-animating", "false");
  expect(await curve.locator("path[stroke]").getAttribute("d")).not.toBe(
    firstPath,
  );
  await device.push(false);
  await expect(curve).toHaveAttribute("data-samples", "3");
  await page
    .locator(".sidebar-navigation")
    .getByRole("button", { name: /^系统诊断/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "设备运行趋势", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("CPU资源趋势", { exact: true }).locator(".resource-curve"),
  ).toHaveAttribute("data-samples", "3");
  expect(device.mutations).toEqual([]);
});

test("resource updates tween from the previous value while battery status changes immediately", async ({
  page,
}) => {
  const device = await mockDevice(page);
  await page.goto("/#live");
  await expect(cpuDisplay(page)).toHaveText("64.0");
  await expect(cpuNumber(page)).toHaveAttribute("data-counting", "false");
  device.status.cpu_percent = 42;
  device.status.battery_status.percentage = 41;
  await device.push();
  await expect(cpuNumber(page)).toHaveAttribute("data-target", "42");
  const value = Number(await cpuDisplay(page).textContent());
  expect(value).toBeGreaterThanOrEqual(42);
  expect(value).toBeLessThanOrEqual(64);
  await expect(page.getByLabel("设备概览")).toContainText("41%");
  await expect(cpuDisplay(page)).toHaveText("42.0");
  expect(device.mutations).toEqual([]);
});

test("missing samples stay empty and reduced motion shows final values immediately", async ({
  page,
}) => {
  const device = await mockDevice(page, true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#diagnostics");
  await expect(page.locator(".resource-curve[data-samples='0']")).toHaveCount(
    3,
  );
  await expect(page.locator(".resource-curve path[stroke]")).toHaveCount(0);
  await expect(
    page.locator(".resource-metric .animated-number-value"),
  ).toHaveText(["—", "—", "—"]);
  device.status.cpu_percent = 24.5;
  await device.push();
  const number = page
    .getByLabel("CPU资源趋势", { exact: true })
    .locator(".animated-number");
  await expect(number.locator(".animated-number-value")).toHaveText("24.5");
  await expect(number).toHaveAttribute("data-counting", "false");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page
    .locator(".sidebar-navigation")
    .getByRole("button", { name: /^系统诊断/ })
    .click();
  await expect(number).toHaveAttribute("data-counting", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(number).toHaveAttribute("data-counting", "false");
  await expect(number.locator(".animated-number-value")).toHaveText("24.5");
});
