# CarMove 前端

React + TypeScript + Vite 无人车操作平台，包含实时视频与操控、建图导航、录像记录、算法库和设备诊断。窄屏自动使用手机采集与监控页面。

当前主题沿用 FlClash 默认 `#007AFF` 种子色及 vivid 颜色规则，支持浅色、深色和跟随系统；主要图标及资源曲线也按上游定义适配。

## 本地开发

```bash
npm ci
npm run dev
```

打开 Vite 打印的地址。前端依赖本项目的 FastAPI Server 与板端 Agent。开发时可在本地 `.env.local` 中设置 `VITE_API_BASE` 指向 Server；部署时由 Server 同源提供 `dist/`，通常不需要设置该变量。登录使用运行环境的服务端账号配置，源码不包含登录凭据。

## 构建与测试

```bash
npm run build
npx playwright install chromium
npx playwright test
```

构建结果在 `dist/`。39 项浏览器测试使用模拟 HTTP 与 WebSocket，验证模型选择、设置弹窗、状态乱序、记录翻页、图片切换、控制请求契约、真实数据采样逻辑、主题颜色与键盘操作，不操作实车。

如需重新生成默认主题：

```bash
npm run generate:theme
```

## 维护位置

- `src/components/LiveWorkspace.tsx`：视频、模型与车辆操控界面。
- `src/components/AlgorithmLibrary.tsx`、`src/algorithms.ts`：算法目录、说明和运行入口。
- `src/components/ModelSettingsDialog.tsx`、`SegmentedControl.tsx`：设置编辑和分段选择。
- `src/hooks/useVideoConnection.ts`：可取消的视频协商、重试与备用画面。
- `src/hooks/useDeviceStatus.ts`：桌面与手机的状态接收、断线处理及初始请求取消。
- `src/hooks/useMediaGallery.ts`：录像、照片和检测记录的翻页、去重及重试。
- `src/mapImage.ts`：地图图片解码和尺寸检查。
- `src/components/ResourceTrends.tsx`、`hooks/useResourceHistory.ts`：会话采样与资源图表。
- `src/flclash-theme.css`、`src/flclash-surfaces.css`：生成的颜色角色和上游表面样式。
- `src/components/FlClashIcons.tsx`：上游图标的 SVG 适配。

说明：[算法库](../../../../docs/15-algorithm-library.md)、[交互调整](../../../../docs/16-interface-usability.md)、[配色与图标](../../../../docs/17-flclash-theme.md)、[视频与地图修复](../../../../docs/18-frontend-reliability.md)。

## 上游授权

FlClash／prism_ui 的图标、主题及图表适配包含 GPL-3.0 源码，使用和分发时请保留对应源码与声明。完整来源、固定版本、转换差异及授权文本见 [NOTICE](public/licenses/flclash/NOTICE.md)。Material Color Utilities 使用 Apache-2.0，保留的 Heroicons 使用 MIT。未将整个原有仓库的其他模块重新声明为同一种许可证。
