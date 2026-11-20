# Mobile Interface Implementation Plan

**Goal:** 对齐手机与桌面视觉，并保持设备交互行为。

**Architecture:** 复用桌面 ThemeSelector 与 VideoStream console 展示。新增独立 mobile.css 覆盖手机视觉，避免触碰设备控制逻辑。

**Tech Stack:** React、TypeScript、Vite、现有 FlClash tokens、Playwright。

## 执行步骤（当前对话内顺序执行）

- [x] 增加 `tests/mobile-interface.spec.ts`：主题记忆及系统跟随、视频失败后无破图且可重试、320/390/760px 各页按钮和滚动末项可达；运行并确认新增行为测试失败。
- [x] 提取 `src/components/ThemeSelector.tsx`，桌面与手机共用；手机登录、已登录页添加入口。手机 VideoStream 设置 `presentation="console"`，底部状态文案对应失败状态。
- [x] 新增 `src/mobile.css` 并在 main.tsx 最后加载：使用现有 tokens，统一卡片、字体、表单、状态、登录与底部导航；保留原有数据和操作绑定。
- [x] 运行 `npm run build` 和完整 Playwright 回归，修复由本次变动引起的问题。用本地 Edge 浏览器配置运行，不新增运行时依赖。
- [ ] 扩展 `scripts/capture-screenshots.mjs` 覆盖手机采集、监控、记录、登录与深色，人工检查图片。更新前端说明与 README 引用。
- [ ] 提交前端代码后重建截图，检查来源和引用，再提交展示图；推送并核实远端提交。

## 验收命令

前端目录：`npm run build`；`npx playwright test`；`npm run screenshots`。本机测试通过临时配置指定 channel=msedge，截图通过 SCREENSHOT_BROWSER_CHANNEL=msedge 使用已安装 Edge。所有测试与预览均隔离设备请求。
