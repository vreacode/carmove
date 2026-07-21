# CarMove 原生 Android 控制台

Android 端已经从 WebView 壳开始迁移为原生 MVP。桌面端 React/Vite Dashboard 和板端 Agent/Server API 保持不变。

当前原生页面包含：

- Dashboard 地址、账号密码登录和本地 token 保存
- 状态轮询、联网状态、底盘状态、运动安全状态
- 后端滤波后的电压/电量显示和低电压颜色提示
- 原生 ImageView 接收 Dashboard 的 MJPEG 备用视频流
- 场景、备注、间隔、时长配置，以及开始/停止采集和拍照
- 基础运动按钮与急停；底盘的 dry-run、解锁和导航互锁仍由后端安全状态机决定

## 构建

当前 Android 工程使用旧版 Gradle/Android Gradle Plugin，以兼容现有构建环境。Windows 上进入：

```text
apps/nano-deploy/mobile/android
```

执行：

```bat
gradlew.bat :app:assembleDebug
```

APK 位于：

```text
app\build\outputs\apk\debug\app-debug.apk
```

## 后续原生化

下一步将把 MJPEG 备用流替换为 Android 原生 WebRTC 接收器，再补充采集历史缩略图、红外切换、地图和模型控制。Tailscale 继续由官方 Android 客户端负责 VPN 连接，原生 App 只连接 Dashboard 的 Tailscale 地址。
