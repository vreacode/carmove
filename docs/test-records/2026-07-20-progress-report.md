# 2026-07-20 项目推进报告

## 本轮目标

继续推进手机现场采集/监控闭环；补齐采集历史回看；确认是否可以读取小车电量；完成源码和实际运行树验证；报告完成后按要求关机。

## 本轮完成

1. 手机“记录”页新增历史采集段列表，不再只显示 Agent 进程内存中的当前任务。
2. Agent 扫描 `CAPTURE_OUTPUT_ROOT/manifests/*.csv`，按最近采集时间排序，返回场景、来源、帧数、时间、备注和代表帧。
3. 增加受保护的历史代表帧接口：`/api/capture/gallery/{group}/latest`；组名校验和文件路径校验均限制在采集根目录内。
4. Android/PWA 手机端历史列表显示代表帧、可见光/红外来源、帧数、时间和备注。
5. 根据 Wheeltec 底盘源码接入只读电量链路：
   - `/PowerVoltage`：`std_msgs/Float32`，单位 V；
   - `/robot_charging_flag`：充电状态；
   - `/robot_charging_current`：充电电流。
6. Agent 新增后台 ROS 订阅桥，不发布任何底盘或云台命令；手机监控页显示电压/百分比/充电状态。
7. 百分比计算要求显式配置 `BATTERY_EMPTY_VOLTAGE` 和 `BATTERY_FULL_VOLTAGE`；未标定时只显示真实电压，不伪造百分比和低电量告警。
8. 修复电量桥在 SIGTERM 下的 ROS shutdown 双重调用问题。

## 源码提交

- `4eb4fd1 feat: add capture session history gallery`
- `532ab6b feat: expose read-only robot battery status`

前端书籍目录和 ZT6 手册仍保持未跟踪，未进入提交。

## 验证证据

- 依赖轻量单测：38 项通过。
- 源码 Dashboard `npm run build`：通过。
- 实际 systemd 工作树 Dashboard `npm run build`：通过。
- Agent/Server Python 编译和路由导入：通过。
- `nano-board-agent.service`：`active`。
- `nano-dashboard-server.service`：`active`。
- 登录、Agent `/health`、Dashboard `/api/system/status`：HTTP 200。
- 实际手机采集历史接口：HTTP 200，返回 2 个会话。
- 实际历史代表帧接口：HTTP 200，`image/jpeg`，读取成功。

## 电量实机结果

为验证真实链路，临时启动了底盘基础 ROS 链路；未发送速度命令、未启动导航、未操作云台。

- `/PowerVoltage` 真实消息：约 `22.717 V`。
- Agent 连续读取：约 `22.717–22.720 V`。
- 启动底盘 readiness：底盘节点、`cmd_vel` 订阅和 `/odom` 均就绪。
- 读取完成后已停止底盘；最终状态为 `running=false`、`armed=false`、`dry_run`、`manual_override=false`、`real_publish_enabled=false`。
- 底盘停止后电池状态变为 `available=false`，这是因为没有新的 ROS 发布者；Agent 保留最后读数但不会把它误报为当前在线电量。

## 当前限制

项目资料没有确认电池组的满电/空电电压，也没有确认充电状态和电流话题当前是否在所有底盘固件上发布。因此现在只能可靠显示电压，不能负责任地把 `22.72 V` 转成百分比或判断“还剩多少分钟”。确认电池规格后，在实际 `.env` 配置：

```dotenv
BATTERY_EMPTY_VOLTAGE=...
BATTERY_FULL_VOLTAGE=...
BATTERY_LOW_VOLTAGE=...
```

配置后手机端才会显示百分比并触发低电量状态。

## 实际运行树说明

本轮新增功能已同步到 `/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy` 并重启验证。该工作树原本包含用户自己的云台、停车、事件记录和推理改动，因此没有把整棵树提交；源码仓库的可审查版本已由上面两个提交保存。

## 关机前状态

报告写入后执行关机。关机前保持底盘停止、控制 dry-run/locked、无模型和导航任务；电量功能已完成验证，但未进行自动关机判断，因为当前电池百分比尚未标定。
