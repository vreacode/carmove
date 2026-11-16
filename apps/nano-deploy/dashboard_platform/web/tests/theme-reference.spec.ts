import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const tokens = JSON.parse(readFileSync(new URL("../src/theme/flclash-tokens.json", import.meta.url), "utf8")) as { seed: string; schemes: Record<"light" | "dark", Record<string, string>> };

async function mockResources(page: Page) {
  const sockets: { send: (data: string) => void }[] = [];
  let tick = Date.parse("2026-11-16T14:00:00Z");
  const status = { agent_online: true, board_online: true, board_name: "Jetson Nano", current_model: "helmet",
    available_models: [{ id: "helmet", label: "安全帽检测", weight: "helmet.pt" }], model_status: { running: false },
    cpu_percent: 40, memory_percent: 52, gpu_percent: 20, last_heartbeat: new Date(tick).toISOString(),
    battery_status: { available: true, percentage: 82, voltage: 25.1 },
    motion_state: { armed: false, mode: "dry_run", require_manual_arm: true, nav_lockout: false, cruise_active: false } };
  const mutations: string[] = [];
  await page.addInitScript(() => { localStorage.setItem("dashboard_token", "test-token"); localStorage.setItem("app-theme", "light"); });
  await page.routeWebSocket(/\/ws\//, (socket) => { if (socket.url().includes("/ws/status")) { sockets.push(socket); socket.send(JSON.stringify(status)); } });
  await page.route("**/api/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path.startsWith("/api/stream/")) { await route.fulfill({ status: 409, body: "preview only" }); return; }
    if (req.method() !== "GET") mutations.push(path);
    await route.fulfill({ json: path === "/api/system/status" ? status : path === "/api/maps" || path === "/api/media/gallery" ? { items: [] } : {} });
  });
  return { mutations, push: async (index: number) => {
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    status.cpu_percent = 35 + Math.sin(index / 4) * 20 + Math.sin(index / 2) * 7;
    status.memory_percent = 48 + Math.sin(index / 7) * 8;
    status.gpu_percent = 18 + Math.sin(index / 5) * 12;
    status.last_heartbeat = new Date(tick += 1000).toISOString();
    sockets.forEach((socket) => socket.send(JSON.stringify(status)));
  } };
}
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

test("default theme uses FlClash source tokens and imported sidebar glyphs", async ({ page }) => {
  const device = await mockResources(page);
  await page.goto("/#algorithms");
  await expect(page.locator(".sidebar-navigation .sidebar-link-icon[data-icon-source='flclash']")).toHaveCount(5);
  expect(tokens.seed).toBe("#007AFF");
  expect(tokens.schemes.light.primary).toBe("#007aff");
  for (const mode of ["light", "dark"] as const) {
    await page.getByRole("combobox", { name: "外观", exact: true }).selectOption(mode);
    await expect(page.locator(".dashboard-workspace")).toHaveCSS("background-color", rgb(tokens.schemes[mode].page));
    await expect(page.locator(".catalog-list-panel")).toHaveCSS("background-color", rgb(tokens.schemes[mode].panel));
    await expect(page.locator(".catalog-action .live-button")).toHaveCSS("background-color", rgb(tokens.schemes[mode].primary));
  }
  expect(device.mutations).toEqual([]);
});

test("resource charts use source line and area styling with received samples in both themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const device = await mockResources(page);
  await page.goto("/#diagnostics");
  const curve = page.getByLabel("CPU资源趋势", { exact: true }).locator(".resource-curve");
  await expect(curve).toHaveAttribute("data-samples", "1");
  for (let i = 1; i <= 35; i++) { await device.push(i); await expect(curve).toHaveAttribute("data-samples", String(i + 1)); }
  await expect(curve.locator("path[stroke]")).toHaveAttribute("stroke-width", "2");
  await expect(curve.locator("path[fill-opacity]")).toHaveAttribute("fill-opacity", "0.14");
  await expect(page.locator(".resource-grid-line")).toHaveCount(0);
  await page.screenshot({ path: "test-results/flclash-charts-light.png", fullPage: true });
  await page.getByRole("combobox", { name: "外观", exact: true }).selectOption("dark");
  await page.screenshot({ path: "test-results/flclash-charts-dark.png", fullPage: true });
  await page.locator(".sidebar-navigation").getByRole("button", { name: /^实时监控/ }).click();
  await page.screenshot({ path: "test-results/flclash-live-dark.png", fullPage: true });
  expect(device.mutations).toEqual([]);
});

test("follow system switches the same source palette without a custom warm theme", async ({ page }) => {
  const device = await mockResources(page);
  await page.goto("/#algorithms");
  await page.getByRole("combobox", { name: "外观", exact: true }).selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("combobox", { name: "外观", exact: true }).locator("option")).toHaveText(["跟随系统", "浅色", "深色"]);
  expect(device.mutations).toEqual([]);
});
