# FlClash 配色 图标与图表

2026 年 11 月 16 日根据用户要求，使用 FlClash 的默认颜色规则、主要图标定义和图表绘制方式替换原先自行搭配的版本。

## 来源与颜色

FlClash 固定版本 `be84736605527034689c95bf27828ff27d912c5e`，其 prism_ui 子模块版本 `63450c0ac0e8e1b2c0f3ed4ad7926dc94e083185`。

- 默认主题种子来自 FlClash `lib/common/constant.dart`：`#007AFF`。
- 使用默认 `ColorStyle.vivid`；背景、表面、文字和容器色遵循 prism_ui `lib/color.dart` 与 `lib/surface.dart`。
- 浅色主色 `#007AFF`，深色主色按原来的 HCT 明度提升规则生成 `#2F83FF`。没有额外设计暖灰或独立图表配色。
- 浅色／深色／跟随系统只切换这套源规则生成的颜色。原暖灰存储值按跟随系统处理。FlClash 本身支持自选强调色与系统动态色，因此这里对应默认配色，不保证与任意个人设置的 FlClash 一致。

开发时运行 `npm run generate:theme`，生成 `src/flclash-theme.css` 和 `src/theme/flclash-tokens.json`。生成器使用固定开发依赖 Material Color Utilities 0.4.0 的 HCT 计算；浏览器不加载该计算库。

## 图标

37 个常用图标由上游 AppGlyphs 和 Glyphs 的坐标转换为 24×24 SVG，沿用 1.8 像素笔画与圆角折线定义。覆盖菜单、CPU／内存、摄像头、设置、查找、刷新、锁定、播放／暂停等。

全屏、电池、手动接管和两个停止图标保留车辆界面已有符号。Flutter 连续圆角盒在 SVG 中用圆角矩形表示，且未实现上游的轮廓到填充变形动画，因此不是逐像素相同的 Flutter 渲染。

对应源码为 `src/components/FlClashIcons.tsx`；转换脚本 `scripts/import-flclash-icons.py` 接收上游源码目录参数。

## 图表

资源曲线改为上游图表的 2 像素线条、14% 实色面积和卡片贴底布局。采用 Gaussian sigma 1.5、半径 4 的平滑及 Catmull–Rom 路径，三个独立指标均使用主题主色，移除自选蓝绿灰配色和渐变网格。

仍只使用本次连接收到的遥测，保留最近 60 次采样。百分比读数使用最新原始数据；曲线为平滑展示，未补造历史数据。保留原来的数值过渡、实时状态与缺失数据处理。

## 验证与授权声明

在 `dashboard_platform/web` 运行 `npx playwright test`。新增检查包括计算出的浅深色角色、图标来源、跟随系统、曲线绘制属性；原有模型与控制测试继续覆盖接口行为。所有设备请求由模拟接口拦截，不操作实车。

这些移植文件包含 GPL-3.0 的上游适配；来源、版本与授权文本已收入 `public/licenses/flclash/`，重分发时应一并保留。Material Color Utilities 的 Apache-2.0 声明也同时保留。前一轮仅参考布局的说明不代表本轮图形与样式移植的授权范围。

修改前源码备份、测试记录与模拟数据预览在本机 `diagnostics/flclash_theme_20261116/`。原 10 月封存材料未修改。
