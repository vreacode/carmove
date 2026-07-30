# 2026-07-30 运行时与现场采集加固

## 已确认根因

`nano-board-agent` 原先停止时有三个长期 HTTP 数据流保持连接，Uvicorn
一直等待连接自然结束；应用退出后，ROS 2 Humble CLI 启动的
`ros2-daemon` 又留在 systemd cgroup 中。两者叠加后，服务每次都等满
默认 90 秒并被 SIGKILL。

## 修复

- Agent 和 Dashboard 的 Uvicorn 增加 3 秒 graceful shutdown 上限，
  systemd 增加 30 秒停止上限。
- Agent 以及建图、导航、录包、RViz、雷达和诊断脚本的节点/话题状态
  查询统一显式增加 `--no-daemon`。
- 桌面端和手机端 WebSocket 增加指数退避自动重连，并在网络恢复或页面
  回到前台时立即重试。
- RTSP 采集增加运行中磁盘安全余量检查。
- 历史采集段区分 manifest 行数和实际可读文件数，显示缺失数量、数据
  大小和完整性；文件读取进一步限制到对应采集组目录。

## 实机证据

- 修复前 Agent 停止耗时：`90083 ms`，systemd 结果为 `timeout/SIGKILL`。
- 修复后在 4 条实时连接持续打开时，Agent 重启命令耗时约 `7.5 s`，
  健康接口恢复约 `12.7 s`。
- Dashboard 重启命令耗时约 `0.2 s`，健康接口恢复约 `1.9 s`。
- Agent cgroup 内 `ros2cli.daemon` 残留数为 0。
- Agent、Dashboard、XT-16 三项用户服务均为 `active`，8080/9001 健康
  接口均正常。
- 真实可见光 1 帧烟测：1920×1080、0 解码告警、manifest 1 行、可读
  文件 1 张、缺失 0、完整性通过；测试采集段随后已删除。
- 室外短录包烟测：XT-16 10.1 Hz、Yesense 200.0 Hz、64000 点/帧；
  2.01 秒包为 22.5 MiB，包含 14 帧 `/lidar_points` 和 167 帧
  `/imu/data_raw`，metadata 完整，停止后无 Yesense/rosbag 子进程残留；
  临时包已移入回收站。

## 回归结果

- Agent 单元测试：34 项通过。
- Server 单元测试：2 项通过。
- 数据集与采集工具测试：13 项通过。
- SIYI ZT6 协议测试：7 项通过。
- 自主建图 frontier 算法测试：2 项通过。
- 视觉事件规则测试：4 项通过。
- Python 回归测试合计：62 项通过。
- 前端 TypeScript + Vite 生产构建：通过。
- systemd unit 校验、Shell 语法和 Python 编译检查：通过。
