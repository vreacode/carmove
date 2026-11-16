# FlClash 交互参考与界面调整

2026 年 11 月 16 日。将本项目桌面前端从说明密集的展示页面调整为更便于日常操作的控制界面。参考 FlClash 的设置分组、聚焦编辑和明确的操作层级，用现有 React 技术实现。

## 具体调整

- 算法库改为紧凑列表与详情，去掉独立宣传说明区。数量保留为一行摘要，主要操作前置；运行条件和限制按需展开。窄屏选择算法后滚动到详情。
- 模型未运行时显示「启动模型」，选中另一模型时显示「切换模型」，同一模型运行时显示「重启模型」。未运行时不能停止；设备离线或没有对应模型配置时不能启动。
- 「检测设置」使用原生模态弹窗，输入源与违停参数先保存为草稿。「保存设置」本地校验后应用到下一次模型启动请求；取消、Esc 或点击弹窗外部丢弃草稿。关闭后焦点回到设置入口。
- 分类、画面模式与速度档位使用统一的分段控件，支持方向键、Home 和 End。外观用带文字的选择框，原有浅色、深色、暖灰存储值保持兼容。
- 去掉 PRO、WORKSPACE 等装饰性文案和菜单假就绪标记，统一建图导航、录像记录、检测结果等名称。不在算法库等页面显示尚未连接的视频状态。
- 驾驶快捷键只在实时监控页生效；弹窗打开、表单或按钮获得焦点、按下 Ctrl/Alt/Meta 时不拦截键盘操作。

既有资源数字与曲线、车型控制保护、后台接口契约和手机采集页沿用原实现。没有新增前端依赖。仓库与运行目录分别构建，视频连接实现已有差异只修改显示文案。

## 参考来源

参考代码版本：`be84736605527034689c95bf27828ff27d912c5e`。以下来源用于研究交互组织，没有复制 Flutter 源码、品牌或素材：

- [FlClash](https://github.com/chen08209/FlClash)
- [分组设置与选项控件](https://github.com/chen08209/FlClash/blob/be84736605527034689c95bf27828ff27d912c5e/lib/widgets/config_item.dart)
- [列表项操作模型](https://github.com/chen08209/FlClash/blob/be84736605527034689c95bf27828ff27d912c5e/lib/ui/list_item.dart)
- [输入与校验](https://github.com/chen08209/FlClash/blob/be84736605527034689c95bf27828ff27d912c5e/lib/widgets/input.dart)

## 验证与文件

`npx playwright test` 共 15 项通过，覆盖原有控制、急停、模型选择、曲线采样，以及新设置的校验、取消、焦点返回、键盘交互和页面布局。全部设备 API 与 WebSocket 使用模拟响应，没有实车控制。截图中的状态和数据也来自模拟设备，仅用于检查界面。

主要源码：`components/AlgorithmLibrary.tsx`、`components/LiveWorkspace.tsx`、`components/ModelSettingsDialog.tsx`、`components/SegmentedControl.tsx`、`App.tsx`、`refinement.css` 和 `live.css`。在 `dashboard_platform/web` 运行 `npm run build` 构建。

修改前两套源码与运行前端已备份到本机 `diagnostics/flclash_usability_20261116/`。预览截图也保存在该目录，诊断材料受 Git 忽略规则排除。10 月封存目录未修改。
