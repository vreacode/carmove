# CarMove 手机现场控制台

这是一套复用现有 Dashboard 后端的移动端 MVP。屏幕宽度不超过 760px 时，前端自动切换为手机界面；桌面端仍然保留原来的工作台。

当前手机端优先支持：

- 可见光 WebRTC 实时画面，并保留 MJPEG 备用画面
- 可见光/红外源切换，并按场景、备注、采样间隔和时长启动/停止 RTSP 原始帧采集
- 单帧快照
- CPU、内存、GPU、相机、雷达、IMU、云台和运动安全状态监控
- 最近一帧和 manifest 路径查看
- 历史采集段列表，按最新采集时间排序，并显示每段的代表帧、帧数、来源和备注

采集数据由板端 Agent 启动 `tools/collect_rtsp_frames.py`，默认落在：

```text
/home/nvidia/carmove/datasets/local/roadside_v1/
├── images/<scene>_<YYYY-MM-DD>/*.jpg
└── manifests/<scene>_<YYYY-MM-DD>.csv
```

手机“记录”页读取 `manifests/` 下的 CSV，而不是只依赖 Agent 进程内存中的当前状态。因此 Agent/Dashboard 重启后，已经完成的采集段仍然可见。每个历史条目的代表帧通过受保护的 `/api/capture/gallery/{group}/latest` 读取；接口只接受合法的采集组名，并且只返回 `CAPTURE_OUTPUT_ROOT` 内的文件。

## Tailscale 拓扑

手机和运行 Dashboard 的设备都加入同一个 tailnet。手机不需要直连 RTSP，也不需要直接暴露 9001 端口：

```text
手机浏览器/PWA ── Tailscale ── Dashboard :8080 ── Agent :9001 ── RTSP / ZT6
```

如果 Dashboard 和 Agent 不在同一台设备，在 `.env` 中填写 Agent 的 Tailscale 地址：

```dotenv
TAILSCALE_HOST=100.x.y.z
```

如果 Dashboard 就运行在小车这台设备上，手机直接访问这台设备的 Tailscale 地址即可：

```bash
tailscale ip -4
```

然后在手机浏览器打开：

```text
http://<Dashboard设备的Tailscale地址>:8080
```

登录后可通过浏览器的“添加到主屏幕”安装成 PWA。第一版没有把运动控制放进手机页面；现有的 `ENABLE_MOTION_CONTROL=false`、`MOTION_CONTROL_MODE=dry_run` 和 ZT6 云台运动锁继续有效。

## 本地验证

```bash
cd /home/nvidia/carmove/apps/nano-deploy/dashboard_platform/web
npm run build
```

后端构建完成后，按项目原有的 systemd 服务重启 Dashboard 和 Agent，手机页面会随 Dashboard 的 `web/dist` 自动提供。部署时需要确认 Agent 的 `.env` 中 `CAPTURE_SCRIPT`、`CAPTURE_WORKDIR` 和 `CAPTURE_OUTPUT_ROOT` 指向同一台设备上可读写的位置；不要把 RTSP 用户名、密码或 token 写进采集记录页面。

## 设计依据

移动页面按三本书提炼的原则落地：用《点石成金》的“少思考、先给最重要动作和明确状态”，用《Refactoring UI》的移动优先、层级、留白和受限宽度，用《写给大家看的设计书》的对比、重复、对齐和亲密性组织采集/监控/记录三个任务区。颜色不只承担状态含义，在线状态同时有文字；所有采集动作都有进行中、停止、空状态和错误反馈。
