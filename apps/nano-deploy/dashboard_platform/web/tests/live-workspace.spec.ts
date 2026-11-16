import { test, expect, type Page } from "@playwright/test";

// Device requests are fully intercepted: these checks never operate the vehicle.
async function mockDevice(page: Page, { armed = false, offline = false } = {}) {
  const motion = {
    armed,
    mode: "dry_run",
    require_manual_arm: true,
    manual_override: false,
    nav_lockout: false,
    cruise_active: false,
    cruise_steering: "center",
  };
  const status = {
    agent_online: !offline,
    board_online: !offline,
    board_name: "Jetson Nano",
    current_model: "helmet",
    current_video_source: "rtsp://example.invalid/video",
    available_models: [
      { id: "helmet", label: "安全帽检测" },
      { id: "fall", label: "跌倒检测" },
    ],
    model_status: { running: false },
    navigation_running: true,
    mapping_running: false,
    motion_state: offline ? null : motion,
    battery_status: offline
      ? { available: false }
      : { available: true, percentage: 82, voltage: 25.1 },
  };
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  await page.addInitScript(() =>
    localStorage.setItem("dashboard_token", "ui-test-token"),
  );
  await page.routeWebSocket(/\/ws\//, (socket) => {
    if (socket.url().includes("/ws/status"))
      socket.send(JSON.stringify(status));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/stream/")) {
      await route.fulfill({ status: 409, body: "test video disabled" });
      return;
    }
    let payload: unknown = {};
    if (request.method() !== "GET") {
      const body = request.postData() ? request.postDataJSON() : {};
      mutations.push({ path, body });
      if (path === "/api/control/arm") motion.armed = body.armed;
      if (path === "/api/control/manual-override")
        motion.manual_override = body.enabled;
      if (path === "/api/control/cruise/start") motion.cruise_active = true;
      if (path === "/api/control/cruise/steer")
        motion.cruise_steering = body.direction;
      if (
        path === "/api/control/cruise/stop" ||
        path === "/api/control/emergency-stop"
      ) {
        motion.cruise_active = false;
        motion.cruise_steering = "center";
      }
      if (path.startsWith("/api/control/")) payload = motion;
    } else if (path === "/api/system/status") payload = status;
    else if (path === "/api/maps" || path === "/api/media/gallery")
      payload = { items: [] };
    else if (path === "/api/camera/status")
      payload = { enabled: false, connected: false };
    await route.fulfill({ json: payload });
  });
  return { mutations };
}

test("locked controls, unlock, speed, directions, takeover and emergency keep their API contracts", async ({
  page,
}) => {
  const device = await mockDevice(page);
  await page.goto("/#live");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(button("前进")).toBeDisabled();
  await expect(button("启用人工接管")).toBeDisabled();
  await expect(page.getByRole("button", { name: /紧急停车/ })).toBeEnabled();
  expect(device.mutations).toEqual([]);

  await button("解锁控制").click();
  await expect(button("前进")).toBeEnabled();
  expect(device.mutations[0]).toEqual({
    path: "/api/control/arm",
    body: { armed: true },
  });
  await button("低速").click();
  expect(device.mutations).toHaveLength(1);
  for (const [label, command] of [
    ["前进", "forward"],
    ["后退", "backward"],
    ["左转", "left"],
    ["右转", "right"],
    ["停止", "stop"],
  ]) {
    await button(label).click();
    await expect
      .poll(() => device.mutations.at(-1))
      .toEqual({ path: "/api/control/send", body: { command, speed: "low" } });
  }
  await button("启用人工接管").click();
  await expect(button("取消人工接管")).toBeVisible();
  expect(device.mutations.at(-1)).toEqual({
    path: "/api/control/manual-override",
    body: { enabled: true },
  });
  await page.getByRole("button", { name: /紧急停车/ }).click();
  await expect
    .poll(() => device.mutations.at(-1)?.path)
    .toBe("/api/control/emergency-stop");
});

test("cruise disables direct driving and steering returns to center on pointer release", async ({
  page,
}) => {
  const device = await mockDevice(page, { armed: true });
  await page.goto("/#live");
  await page.getByRole("button", { name: "开始匀速前进", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止匀速前进", exact: true }),
  ).toBeVisible();
  expect(device.mutations).toContainEqual({
    path: "/api/control/cruise/start",
    body: { speed: "medium" },
  });
  await expect(
    page.getByRole("button", { name: "高速", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "前进", exact: true }),
  ).toBeDisabled();
  const left = page.getByRole("button", { name: "按住左修正", exact: true });
  await left.hover();
  await page.mouse.down();
  await expect
    .poll(
      () =>
        device.mutations.filter((item) => item.path.endsWith("/steer")).at(-1)
          ?.body,
    )
    .toEqual({ direction: "left" });
  await page.mouse.move(10, 10);
  await page.mouse.up();
  await expect
    .poll(
      () =>
        device.mutations.filter((item) => item.path.endsWith("/steer")).at(-1)
          ?.body,
    )
    .toEqual({ direction: "center" });
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "开始匀速前进", exact: true }),
  ).toBeVisible();
  expect(device.mutations).toContainEqual({
    path: "/api/control/cruise/stop",
    body: {},
  });
});

test("advanced model settings validate ROI and preserve the selected source in the start request", async ({
  page,
}) => {
  const device = await mockDevice(page);
  await page.goto("/#live");
  await page
    .getByRole("combobox", { name: "检测模型", exact: true })
    .selectOption("fall");
  await page.getByRole("button", { name: /检测设置/ }).click();
  await page
    .getByRole("textbox", { name: "视频输入源", exact: true })
    .fill("rtsp://example.invalid/custom");
  await page.getByRole("checkbox", { name: /启用违停判定/ }).check();
  await page
    .getByRole("textbox", { name: "禁停区域归一化坐标", exact: true })
    .fill("0.8,0.2,0.1,0.9");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("违停区域格式无效");
  expect(device.mutations).toEqual([]);
  await page
    .getByRole("textbox", { name: "禁停区域归一化坐标", exact: true })
    .fill("0.1,0.2,0.8,0.9");
  await page
    .getByRole("spinbutton", { name: "违停停留秒数", exact: true })
    .fill("12.5");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "启动模型", exact: true }).click();
  await expect
    .poll(() => device.mutations.at(-1))
    .toEqual({
      path: "/api/model/start",
      body: {
        model_id: "fall",
        source: "rtsp://example.invalid/custom",
        view: false,
        annotate: true,
        parking_zone: [0.1, 0.2, 0.8, 0.9],
        parking_dwell_seconds: 12.5,
      },
    });
});

test("missing telemetry stays explicit; desktop emergency is visible and tablet layout fits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const device = await mockDevice(page, { offline: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#live");
  await expect(page.getByLabel("设备概览")).toContainText("设备离线");
  await expect(page.getByLabel("设备概览")).toContainText("暂无数据");
  await expect(page.locator(".live-control")).toContainText("等待控制状态");
  await expect(page.getByRole("button", { name: /紧急停车/ })).toBeInViewport();
  await expect(
    page.locator('.console-feed-status[data-state="connected"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "解锁控制", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "检测结果", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /检测设置/ }).click();
  await page
    .getByRole("textbox", { name: "视频输入源", exact: true })
    .fill("rtsp://example.invalid/custom");
  await page.keyboard.press("w");
  expect(device.mutations).toEqual([]);
  await page.keyboard.press("Escape");
  for (const width of [768, 1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});


test("settings cancel and Escape discard edits, restore focus, and block driving shortcuts", async ({ page }) => {
  const device = await mockDevice(page, { armed: true });
  await page.goto("/#live");
  const entry = page.getByRole("button", { name: /检测设置/ });
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "检测设置" });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "test-results/model-settings-dialog.png" });
  await dialog.getByRole("textbox", { name: "视频输入源", exact: true }).fill("rtsp://example.invalid/discard");
  await dialog.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("w");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await entry.click();
  await expect(dialog.getByRole("textbox", { name: "视频输入源", exact: true })).toHaveValue("rtsp://example.invalid/video");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({ path: "test-results/live-usability.png", fullPage: true });
  await page.goto("/#algorithms");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("w");
  expect(device.mutations).toEqual([]);
});

test("segmented controls support arrow keys and theme selection is labelled", async ({ page }) => {
  const device = await mockDevice(page);
  await page.goto("/#algorithms");
  await page.getByRole("button", { name: "全部算法", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "视觉识别", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "视觉识别", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "外观", exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(device.mutations).toEqual([]);
});
