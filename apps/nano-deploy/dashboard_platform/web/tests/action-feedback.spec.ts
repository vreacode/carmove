import { test, expect, type Page } from "@playwright/test";

async function device(page: Page, { mobile = false, loggedIn = true, deletion = async () => true } = {} as {
  mobile?: boolean; loggedIn?: boolean; deletion?: () => Promise<boolean>;
}) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const status = { agent_online: true, board_online: true, current_map_name: "", navigation_running: false, mapping_running: false, model_status: { running: false }, available_models: [] };
  const capture = { enabled: true, running: false, frames_saved: 0, storage_free_gb: 128, manifest_path: "" };
  let maps = ["test-map", "other-map"], groups = [{ group: "group-1", scene: "学院楼起点", frames_saved: 5, manifest_name: "group-1.csv", stream_mode: "visible_raw", integrity_ok: true, missing_frames: 0, total_size_bytes: 1024 }];
  const mutations: string[] = [], logins: unknown[] = [];
  let socket: { send: (message: string) => void } | undefined;
  if (loggedIn) await page.addInitScript(() => localStorage.setItem("dashboard_token", "test-token"));
  await page.routeWebSocket(/\/ws\//, (route) => { if (route.url().includes("/ws/status")) { socket = route; route.send(JSON.stringify(status)); } });
  // All device operations, including deletion and login, are simulated.
  await page.route("**/api/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.startsWith("/api/stream/")) { await route.fulfill({ status: 409, body: "test video disabled" }); return; }
    if (path === "/api/auth/login") {
      const body = req.postDataJSON(); logins.push(body);
      await route.fulfill(body.password === "correct" ? { json: { token: "test-token", username: body.username } } : { status: 401, json: { detail: "invalid credentials" } });
      return;
    }
    if (req.method() === "DELETE") {
      mutations.push(path);
      if (!await deletion()) { await route.fulfill({ status: 503, json: { detail: "磁盘忙，请稍后重试" } }); return; }
      if (path.includes("/maps/")) maps = maps.filter((name) => !path.endsWith(`/${name}`));
      else groups = [];
      await route.fulfill({ json: { ok: true } }); return;
    }
    if (req.method() !== "GET") mutations.push(path);
    if (path.endsWith("/image")) { await route.fulfill({ body: Buffer.concat([Buffer.from("P5\n2 2\n255\n"), Buffer.from([0, 254, 205, 254])]) }); return; }
    const payload = path === "/api/system/status" ? status
      : path === "/api/maps" ? { items: maps.map((name) => ({ name, updated_at: "2026-11-17T00:00:00Z" })) }
      : path.includes("/metadata") ? { name: path.split("/")[3], width: 2, height: 2, resolution: 0.05, origin: [0, 0, 0] }
      : path === "/api/capture/gallery" ? { items: groups }
      : path === "/api/capture/status" ? capture
      : path === "/api/camera/status" ? { enabled: false, connected: false }
      : path === "/api/media/gallery" ? { items: [] } : {};
    await route.fulfill({ json: payload });
  });
  return { mutations, logins, status, capture, async push() { await expect.poll(() => !!socket).toBe(true); socket!.send(JSON.stringify(status)); } };
}

async function openDelete(page: Page, mobile: boolean) {
  await page.goto(mobile ? "/" : "/#navigation");
  if (mobile) await page.getByRole("button", { name: "记录", exact: true }).click();
  const trigger = page.getByRole("button", { name: mobile ? "删除 学院楼起点" : "删除地图 test-map", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(mobile ? "学院楼起点" : "test-map");
  return { trigger, dialog };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "capture" : "map"} deletion defaults to cancel; Enter, Escape and backdrop never delete`, async ({ page }) => {
    const hardware = await device(page, { mobile });
    const { trigger, dialog } = await openDelete(page, mobile);
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    expect(hardware.mutations).toEqual([]);
  });

  test(`${mobile ? "capture" : "map"} deletion waits for confirmation, prevents duplicates, retries errors and restores useful focus`, async ({ page }) => {
    let release!: () => void, attempts = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const hardware = await device(page, { mobile, deletion: async () => { attempts++; if (attempts === 1) { await gate; return false; } return true; } });
    const { trigger, dialog } = await openDelete(page, mobile);
    expect(hardware.mutations).toEqual([]);
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "正在删除…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect.poll(() => hardware.mutations.length).toBe(1);
    release();
    await expect(dialog.getByRole("alert")).toContainText("磁盘忙");
    await expect(dialog.getByRole("button", { name: "确认删除", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    await expect(mobile ? page.getByRole("heading", { name: "历史采集", exact: true }) : page.getByRole("button", { name: "刷新地图列表", exact: true })).toBeFocused();
    expect(hardware.mutations).toEqual(Array(2).fill(mobile ? "/api/capture/gallery/group-1" : "/api/maps/test-map"));
  });

  test(`${mobile ? "mobile" : "desktop"} login validates empty fields and submits with Enter after an error`, async ({ page }) => {
    const hardware = await device(page, { mobile, loggedIn: false });
    await page.goto("/");
    const password = page.getByLabel("密码", { exact: true });
    await password.press("Enter");
    expect(hardware.logins).toEqual([]);
    await password.fill("wrong");
    await password.press("Enter");
    await expect(page.getByRole("alert")).toContainText("不正确");
    await password.fill("correct");
    await password.press("Enter");
    await expect(page.getByText(mobile ? "小车在线" : "设备在线", { exact: true })).toBeVisible();
    expect(hardware.logins).toHaveLength(2);
    expect(hardware.mutations).toEqual([]);
  });
}

test("a map that becomes active while confirmation is open cannot be deleted", async ({ page }) => {
  const hardware = await device(page);
  const { dialog } = await openDelete(page, false);
  hardware.status.current_map_name = "test-map";
  hardware.status.navigation_running = true;
  await hardware.push();
  await expect(page.getByRole("button", { name: "删除地图 test-map", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("正在使用");
  expect(hardware.mutations).toEqual([]);
});

test("a capture group that becomes active while confirmation is open cannot be deleted", async ({ page }) => {
  const hardware = await device(page, { mobile: true });
  const { dialog } = await openDelete(page, true);
  hardware.capture.running = true;
  hardware.capture.manifest_path = "/capture/group-1.csv";
  await expect(page.getByRole("button", { name: "删除 学院楼起点", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("正在采集");
  expect(hardware.mutations).toEqual([]);
});
