import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

const status = {
  agent_online: true, board_online: true, current_model: "helmet",
  current_video_source: "rtsp://example.invalid/default",
  available_models: [{ id: "helmet", label: "安全帽检测" }, { id: "fall", label: "跌倒检测" }],
  model_status: { running: false, model_id: "helmet" },
};

// All requests are intercepted, including model commands. No vehicle is operated.
async function device(page: Page, httpError = false) {
  let socket: WebSocketRoute;
  let latestPacket: string | undefined;
  let release!: () => void;
  let requested = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("dashboard_token", "test-token"));
  await page.routeWebSocket(/\/ws\//, (route) => {
    if (route.url().includes("/ws/status")) {
      socket = route;
      if (latestPacket !== undefined) route.send(latestPacket);
    }
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/system/status") {
      requested++;
      await gate;
      await route.fulfill(httpError ? { status: 503, json: { detail: "old request failed" } } : { json: status }).catch(() => undefined);
      return;
    }
    if (path.startsWith("/api/stream/")) {
      await route.fulfill({ status: 409, json: { detail: "test video disabled" } });
      return;
    }
    if (request.method() !== "GET") {
      const body = request.postData() ? request.postDataJSON() : {};
      mutations.push({ path, body });
      await route.fulfill({ json: { ok: true, model_status: {
        running: path !== "/api/model/stop", model_id: body.model_id || "fall",
      } } });
      return;
    }
    await route.fulfill({ json: path === "/api/maps" || path.includes("gallery") ? { items: [] }
      : path === "/api/camera/status" ? { enabled: false, connected: false } : {} });
  });
  return {
    mutations, errors,
    ready: async () => {
      await expect.poll(() => requested).toBeGreaterThan(0);
      await expect.poll(() => !!socket).toBe(true);
    },
    send: (payload: unknown) => { latestPacket = JSON.stringify(payload); socket.send(latestPacket); },
    malformed: () => socket.send("{invalid"),
    disconnect: () => { latestPacket = undefined; socket.close(); },
    async release() {
      const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/api/system/status");
      release();
      await (await response).finished();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    },
  };
}

for (const mobile of [false, true]) {
  for (const scenario of ["late snapshot", "late error", "disconnect"] as const) {
    test(`${mobile ? "mobile" : "desktop"} ignores ${scenario} from initial status request`, async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const hardware = await device(page, scenario === "late error");
      await page.goto("/#live");
      await hardware.ready();
      hardware.malformed();
      hardware.send({ agent_online: true }); // Partial packets cannot replace a complete status.
      hardware.send({ ...status, model_status: { running: true, model_id: "helmet" } });
      const online = page.getByText(mobile ? "小车在线" : "设备在线", { exact: true });
      await expect(online).toBeVisible();
      if (scenario === "disconnect") {
        hardware.disconnect();
        await expect(page.getByText(mobile ? "等待小车" : "设备离线", { exact: true })).toBeVisible();
      }
      await hardware.release();
      if (scenario === "disconnect") {
        await expect(online).toHaveCount(0);
      } else {
        await expect(online).toBeVisible();
        if (!mobile) await expect(page.getByRole("button", { name: "重启模型", exact: true })).toBeEnabled();
      }
      await expect(page.getByText("old request failed", { exact: false })).toHaveCount(0);
      expect(hardware.errors).toEqual([]);
      expect(hardware.mutations).toEqual([]);
    });
  }
}

test("an HTTP snapshot can initialize the workspace before any stream message", async ({ page }) => {
  const hardware = await device(page);
  await page.goto("/#live");
  await hardware.ready();
  await hardware.release();
  await expect(page.getByText("设备在线", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "启动模型", exact: true })).toBeEnabled();
  expect(hardware.errors).toEqual([]);
  expect(hardware.mutations).toEqual([]);
});

test("saving an empty input source survives subsequent device updates", async ({ page }) => {
  const hardware = await device(page);
  await page.goto("/#live");
  await hardware.ready();
  hardware.send(status);
  await hardware.release();
  await page.getByRole("button", { name: /检测设置/ }).click();
  const source = page.getByRole("textbox", { name: "视频输入源", exact: true });
  await expect(source).toHaveValue(status.current_video_source);
  await source.fill("");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  hardware.send({ ...status, current_model: "fall" });
  await expect(page.getByRole("combobox", { name: "检测模型", exact: true })).toHaveValue("fall");
  await page.getByRole("button", { name: /检测设置/ }).click();
  await expect(source).toHaveValue("");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("button", { name: "启动模型", exact: true }).click();
  await expect.poll(() => hardware.mutations.at(-1)?.body.source).toBe("");
});

test("confirmed model responses update start, switch, restart and stop without another stream packet", async ({ page }) => {
  const hardware = await device(page);
  await page.goto("/#live");
  await hardware.ready();
  hardware.send(status);
  await hardware.release();
  const button = (name: string) => page.getByRole("button", { name, exact: true });
  await button("启动模型").click();
  await expect(button("重启模型")).toBeEnabled();
  await expect(button("停止模型")).toBeEnabled();
  await page.getByRole("combobox", { name: "检测模型", exact: true }).selectOption("fall");
  await button("切换模型").click();
  await expect(button("重启模型")).toBeEnabled();
  await button("重启模型").click();
  await expect.poll(() => hardware.mutations.map((item) => item.path)).toEqual([
    "/api/model/start", "/api/model/restart", "/api/model/restart",
  ]);
  await button("停止模型").click();
  await expect(button("启动模型")).toBeEnabled();
  await expect(button("停止模型")).toBeDisabled();
  expect(hardware.mutations.at(-1)?.path).toBe("/api/model/stop");
  expect(hardware.errors).toEqual([]);
});
