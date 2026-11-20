# 前端界面截图

这里保存 GitHub 首页使用的界面展示图。它们由当前 React 前端在浏览器中实际渲染后截取，不是设计稿。

## 更新

在 `apps/nano-deploy/dashboard_platform/web` 目录运行：

```bash
npm ci
npx playwright install chromium
npm run screenshots
```

也可使用已安装的 Chromium 系浏览器。例如 Windows PowerShell 使用 Edge：`$env:SCREENSHOT_BROWSER_CHANNEL='msedge'; npm run screenshots`，此时无需下载 Playwright Chromium。

脚本启动临时本地 Vite 服务，隔离本地环境配置，拦截所有设备 HTTP/WebSocket 接口，不连接板端。模拟数据只用于展示布局；没有真实视频、地图和实车测量。脚本遇到页面异常、横向溢出、外部请求或设备写操作会报错，并在结束时关闭浏览器和服务。

固定生成桌面监控、浅色算法库、深色算法库，以及手机采集（浅／深色）、监控、记录、登录，共八张图片，并将源码提交、截图日期（Asia/Shanghai）、浏览器版本、各图视口和数据来源写入 `manifest.json`。手机图片宽度固定 390px，视口高度扩展至完整内容，避免固定导航出现在长截图中部；实际 320／390／760px 宽、844px 高窗口另由浏览器回归验证。远程 Google Fonts 样式在预览时禁用，沿用前端定义的系统字体回退链，因此与板端字体可能略有差异。在尚未提交的前端上截图时，提交号仅表示基础版本；发布前应先提交前端代码，再生成展示图。

生成后人工查看四张图，确认中文清晰、主题稳定、布局完整、没有敏感信息，再与 README 一起提交。前端更新时尽量同步刷新截图；保持文件名稳定，避免首页链接失效。将来替换为板端实拍页面时，应如实更新来源记录，并先检查账号、令牌、网络地址和私人影像。
