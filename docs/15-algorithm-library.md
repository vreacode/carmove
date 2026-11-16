# 算法库页面

2026 年 11 月 12 日新增。算法库将现有视觉模型、定位建图和导航流程集中到桌面平台，供演示与日常操作使用。打开操作平台后点击左侧「算法库」，或访问 `/#algorithms`。

## 使用

按「视觉识别」「定位建图」「自主导航」筛选，或搜索名称、任务、模型 ID。点击条目可查看用途、输入输出、运行条件和适用边界。

- 视觉模型：点击「加载到实时监控」，模型选择会带入原有页面。点击「启动模型」；已有模型运行时点击「切换模型」。正在运行的条目显示「查看实时结果」。
- 建图：点击「打开建图配置」带入室内或室外配置，以及 GLIM 或 FAST-LIO2 选项。已有建图任务运行时保留当前任务的配置。
- 导航：点击「打开导航页面」，继续使用原有地图、初始位姿和目标设置。

目录中的加载和跳转不发送模型启动、建图或车辆控制命令。设备离线或模型未配置时禁用模型加载。独立的手机采集控制台仍按原有页面工作。

## 数据与能力范围

模型列表与运行状态来自现有 `SystemStatus.available_models`、`model_status` 和建图导航状态。五个已知模型提供中文说明；新配置的模型会以设备给出的名称自动加入目录。未配置的已知模型保留说明并禁用加载。「已配置」只表示设备配置中存在条目；权重文件是否可用由原有启动接口检查。建图与导航条目标为「流程入口」，不推断本机依赖已全部就绪。

核对本机历史权重的 `model.names` 后，目录按实际类别描述：

| 模型 ID | 当前板端权重类别 |
| --- | --- |
| helmet | helmet、head |
| fall | Fall Detected、Walking、Sitting |
| smoke | Cigarette、Person、Smoke、Vape |
| danger | helmet、head，与安全帽模型类别相同 |
| roadside | 按已有路侧部署文档展示 garbage、vehicle |

不将 danger 文件名解释成已经实现独立危险行为检测，也不填写缺少实测的精度、帧率或稳定性数字。导航条目依据现有配置标示 Hybrid A* 与 RPP。更换现有 ID 对应的权重后，应重新核对并更新其说明。

## 维护与验证

条目说明位于 `apps/nano-deploy/dashboard_platform/web/src/algorithms.ts`，页面位于 `src/components/AlgorithmLibrary.tsx`，左侧入口与 hash 路由分别在 SidebarMenu 和 App 中。此改动复用已有后端接口；同时修复状态刷新覆盖用户刚选模型的问题，切换前提示当前运行模型与已选模型。

在 `apps/nano-deploy/dashboard_platform/web` 中执行：

```bash
npm ci
npx playwright install chromium
npm run test:algorithms
npm run build
```

5 项浏览器回归检查覆盖检索空结果、正确模型 ID 转发、后台状态刷新后的选择保持、建图导航跳转、离线与未配置模型、自定义模型、1024 像素宽度和暗色主题。测试拦截全部设备 API 与 WebSocket，不能启动实车任务。仓库与板端分别构建，以保留两套前端已有差异。板端更新仅替换新构建的前端资源，不需要重启底盘或导航服务。

本次代码是 10 月封存后的新增版本，原始 `final-archive-2026-10-05/` 保持封存状态。板端原前端已备份到本机 `diagnostics/algorithm_library_20261112/board-frontend-before.tar.gz`，该诊断目录受 Git 忽略规则排除。
