# 2026-07-19 项目推进阶段报告

## 本次完成

1. 读取并按《智能网联汽车整车技术科创系统》计划盘点项目；
2. 新增 `tools/prepare_yolo_dataset.py`：从采集 manifest 复制图片、按场景+日期成组划分 train/val、生成 YOLO dataset YAML；
3. 新增 `tools/validate_yolo_dataset.py`：检查图片、标签、类别 ID、归一化坐标、框越界、孤立标签和空 split；
4. 新增 `tools/run_unit_tests.sh`，统一运行核心无硬件测试；
5. 补充数据采集、4K 母片、标注约定和 YOLOv5 训练/Jetson 验收文档；
6. 实测 RTSP：可见光 `video1` 为 HEVC 1920×1080/30fps，红外 `video2` 为 HEVC 640×512/30fps；
7. 运行底盘只读 preflight：8 项通过；
8. 运行 ROS 只读 healthcheck：确认底盘、雷达、IMU 尚未启动，缺失话题与当前停机状态一致；
9. 只读查询 ZT6：UDP 在线，硬件 ID `8302209125`，姿态当前约为 yaw 0°、pitch 0°、roll 0°；
10. Dashboard 健康检查通过，未发送任何车辆速度指令和新的云台转动指令。
11. 修复底盘启动文件串口参数名错误，构建 `turn_on_wheeltec_robot` 成功；短时启动验收通过，`/odom` 约 19.9 Hz、IMU/TF/EKF 正常，`/cmd_vel_nav` 发布者为 0，详见 `docs/test-records/2026-07-19-base-runtime.md`。
12. 使用当前 ZT6 可见光 RTSP 实际抓取 1 帧到临时目录，采集脚本、OpenCV/HEVC 解码和 CSV manifest 均正常；探测帧未写入正式数据集。
13. 复核现有 5 张基线图片：属于单一室内导航测试场景，暂不纳入垃圾/车辆训练集，详见 `docs/test-records/2026-07-19-data-review.md`。
14. 新增 `tools/capture_manifest_report.py`，可在标注前统计场景/日期组、帧数、时间跨度、采样间隔和缺失文件；对当前基线正确提示“单组数据不可做有意义的 train/val 划分”。
15. 为预览叠加层增加 2 个无依赖单测，确认 `q` 退出和倒计时显示路径正常。
16. 新增 `tools/run_yolov5_baseline.sh` 训练入口：训练前强制校验数据集和本地权重，禁止隐式下载，避免无标签数据误启动训练。
17. 完成仓库产物审计：Git 未跟踪 `.env`、录像、图片或模型权重；仓库内没有训练权重，但实际部署目录配置的 4 个模型权重均存在且不纳入 Git；Dashboard 两项用户服务保持 active。
18. 修复建图/导航脚本的进程清理方式：移除模糊 `pkill -f`，改为只向本脚本 PID 文件记录的进程发送停止信号，避免误杀同机其他 ROS 实例。
19. 扩展 `tools/ros_healthcheck.sh`：对底盘、原始/融合 IMU、雷达点云和 `/scan` 按实际发布者测频率；停机或无发布者时给出明确跳过原因，不再无谓等待。
20. 增加 Dashboard 控制状态机的 5 个无硬件安全单测，覆盖默认 dry-run/锁定、未解锁拒绝、速度上限、导航互锁和 real 模式底盘就绪条件。
21. 增加 Dashboard 模型启动前的本地权重检查，缺少权重时直接拒绝创建子进程；新增 2 个无硬件模型 preflight 单测。
22. 在线验证实际 Agent 模型生命周期：4 个配置模型权重均可见，启动第一个配置模型后已通过 `/model/stop` 停止，最终 `running=false`，未启动底盘或云台。
23. 将 PID-only 清理修复同步到 Agent 实际使用的建图/导航脚本；现在仓库副本和当前部署副本均不再使用模糊 `pkill -f`。
24. 运行导航入口 `check gmap_map` 只读 preflight：地图和 Nav2 参数文件存在，但因底盘未启动而在 `wheeltec_robot not ready` 处安全退出，没有启动导航进程。
25. 清理 Demo/遗留 GMapping 脚本中的全局 `pkill -f`；Demo 停止流程现在只按自身 PID 文件停止，旧 GMapping 入口不再全局清理 ROS 进程。
26. 新增 `tools/validate_ros_map.py`，在导航前检查地图 YAML 必填字段、相对 PGM 路径、PGM 头、分辨率、原点和阈值；新增 3 个地图预检单测。
27. 将地图预检接入仓库和实际部署的导航 `check` 入口；地图内容校验通过后才会继续检查底盘、里程计和雷达就绪状态。
28. 为 RTSP 采集工具增加 `--duration` 定时停止参数；固定时长和最大帧数可同时限制采集，适合现场无人值守的短段采集。
29. 为 YOLO RTSP 推理脚本增加 `--max-frames`、`--duration` 和完成时 FPS 日志；仓库与当前部署版本均具备这些受控 benchmark 参数（两份脚本原有停车规则代码仍保持各自现状）。
30. 修复 CUDA FP16 预热输入类型不匹配，并为 RTSP 读取线程增加包含异常路径的有序关闭；板端实际用 `helmet.pt`、可见光 `video1`、CUDA FP16 跑 3 帧，完成日志为 `3.26 FPS`、退出码 `0`，无事件文件和残留推理进程；随后 2 帧复测同样以退出码 `0` 完成。
31. 将统一单测脚本改为在板端存在部署 `.venv` 时自动选用它；本轮复跑全部通过，系统 Python 不再因缺少可选测试依赖而误报失败。
32. 在线通过 Agent API 启动并停止 `helmet` 模型（可见光 RTSP、FP16、事件过滤关闭），启动/停止均返回 HTTP 200，最终 `running=false`，未残留推理进程；底盘和云台仍未启动/控制。
33. 用 `tegrastats` 对同样的 FP16 3 帧推理做资源采样：退出码 `0`、实测 `3.29 FPS`，采样窗口 RAM 峰值约 `3.9/7.6 GB`、单核 CPU 峰值约 `87%`、最高温度约 `59.7°C`；该短样本仅作基线，长时间现场运行仍需持续监测。
34. 加强集成建图入口：雷达必须存在 `Publisher count: 1` 才算就绪，并把 PID-only 清理陷阱提前到所有等待/启动前；板端停机实测安全拒绝于 `wheeltec_robot not ready`，无残留建图 PID 文件。
35. 对当前基线 manifest 做完整数据流水线预检：5 张图片按单组进入 train，`validate_yolo_dataset.py` 明确以非零状态拒绝 5 个缺失标签和空 val，确认训练闸门有效。
36. 同步加强集成导航入口：雷达必须存在 `Publisher count: 1`，并在地图/底盘前置检查前安装退出清理；板端 `check gmap_map` 实测仍安全拒绝于 `wheeltec_robot not ready`，无导航 PID 文件。
37. 为仓库旧版 2D 建图/导航入口提前安装 `EXIT/INT/TERM` 清理陷阱；`bash -n`、差异检查和全局清理关键字审计通过。
38. 实测 YOLO `--duration 3` 自动停止：板端可见光 RTSP、CUDA FP16 处理 71 帧，完成日志 `3.04s / 23.34 FPS`，退出码 `0`，事件过滤关闭且无残留推理进程；此前 3 帧结果包含模型/流启动开销，不能直接代表稳态 FPS。
39. 修复 `LoadStreams` 在后台线程更新画面时重复消费同一帧的问题：修复前 `vid_stride=5` 的 3 秒测试处理 80 帧，修复后为 15 帧（`3.09s / 4.85 FPS`）；同条件 `stride=1` 为 66 帧（`3.05s / 21.65 FPS`），两次退出码均为 `0`。
40. 将仓库已有的车辆停留/禁停区域规则同步到板端部署：新增 `vision.event_rules` 导入、`--parking-zone` 等参数和 `EVENT_JSON` 输出；板端规则单测通过，启用停车参数的 1 秒 RTSP 短测退出码 `0`、无残留。该次使用 `helmet.pt`，只证明链路，不代表车辆检测精度。
41. 同步板端 Agent 的 `ModelStartRequest` 和运行命令转发逻辑；在线 API 传入禁停区域后，启动/停止均 HTTP 200，返回命令确认包含 `--parking-zone` 与 `--parking-dwell`，最终 `running=false`、无推理残留。
42. 补齐 Dashboard Server 的停车参数 schema；通过 `/api/model/start` → Agent → RTSP 实测启动/停止均 HTTP 200，命令确认停车参数已透传，最终 `running=false`，Dashboard 健康检查 HTTP 200。
43. 对修复后的默认降帧路径做 10 秒资源基线：`vid_stride=5` 处理 57 帧（`5.64 FPS`）、退出码 `0`，RAM 峰值约 `3.93/7.62 GB`、单核 CPU 峰值约 `86%`、最高温度约 `60.2°C`，结束后无推理残留。
44. 在 Dashboard 模型面板增加违停配置区：默认关闭，开启后填写归一化 ROI 和停留秒数，前端先校验范围再透传；仓库与板端前端构建均通过，实际 8080 静态资源包含“启用违停判定”，健康检查 HTTP 200。
45. 为 Dashboard Server 和 Agent 的违停区域增加服务端校验：越界、反向区域和错误长度均在启动模型前返回 HTTP 422；回归后模型状态保持 `running=false`，服务健康检查 HTTP 200。
46. 为 Agent 的停车区域 schema 增加回归单测，覆盖默认关闭、合法归一化 ROI，以及越界/反向/错误长度输入；全量依赖轻量单测通过。
47. 校正 README 的仓库/板端边界说明：明确板端部署目录会接收受控同步，密钥、权重、媒体和构建产物仍不回写 GitHub，并要求同步后做差异核对。
48. 对本轮同步的推理脚本、数据流、事件规则、Agent 和 Server 做仓库/板端差异审计，均完全一致；板端 Dashboard `App.tsx` 保留既有云台/布局定制，仅确认停车配置已构建并上线。
49. 增加申报材料事实素材提纲，按“算法、平台、数据集”分层整理已验证能力，并明确当前没有垃圾/车辆模型精度结论，待标注训练后补齐 Precision、Recall、mAP 和 Jetson FPS。
50. 为 Dashboard Server 的同名请求 schema 增加 2 项回归单测，确认无效 ROI 在转发到 Agent 前被拒绝；全量依赖轻量单测增至 34 项并通过。
51. 在当前运行版本上做只读回归：34 项单测、Python 编译、核心部署副本一致性均通过；在线登录 HTTP 200，越界/反向/错误长度 ROI 均 HTTP 422，模型保持停止、相机连接正常。

## 测试结果

```text
SIYI protocol tests: 7 passed
vision event-rule tests: 4 passed
dataset-tool tests: 4 passed
frontend build: passed
base preflight: pass=8 warn=0 fail=0
base runtime smoke test: passed (serial, odom, imu, tf, ekf; no cmd_vel publisher)
RTSP capture smoke test: passed (video1, 1 frame, temporary output)
capture manifest report tests: 2 passed
capture preview tests: 2 passed
YOLOv5 training gate smoke test: passed (missing dataset rejected before training)
repository artifact audit: passed (no tracked secrets/media/weights; deployment weights remain outside Git)
mapping/navigation cleanup audit: passed (`bash -n`, PID-file-only cleanup)
ROS rate-check audit: passed (publisher-aware, `RATE_TIMEOUT_SECONDS` configurable)
ROS healthcheck offline run: completed as expected with base stopped; RTSP check passed (HEVC 1920×1080)
motion safety tests: 5 passed (no ROS publisher initialized)
model preflight tests: 2 passed (missing weight rejected before spawn)
live model start/stop smoke test: passed (configured model stopped; running=false)
integrated mapping/navigation cleanup audit: passed (repo and deployed scripts use PID files only)
navigation preflight: expected refusal while base stopped (`wheeltec_robot not ready`), no navigation process started
legacy/demo cleanup audit: passed (no global `pkill -f` in maintained stop/start paths)
ROS map preflight tests: 3 passed
ROS map preflight: `gmap_map.yaml` passed (PGM 2016×608, resolution 0.05 m)
navigation map-gate integration: passed (repo and deployed `check` scripts include map validator)
navigation `check gmap_map`: map gate passed, then correctly refused at `wheeltec_robot not ready`; no navigation process started
RTSP timed-capture syntax/tests: passed
RTSP timed-capture smoke test: passed (1.2s limit, 3 temporary frames, not added to dataset)
YOLO inference bounded-run syntax: passed (bounded options present in repo and deployed scripts)
YOLO FP16 RTSP benchmark: passed (3 frames, 3.26 FPS, exit_code=0, no event output or lingering inference process)
Dashboard → Agent model lifecycle: passed (helmet FP16 start/stop HTTP 200, final running=false, no lingering inference process)
YOLO resource baseline: recorded (tegrastats during 3-frame FP16 run; RAM ~3.9/7.6 GB peak, per-core CPU ~87% peak, temperature ~59.7°C)
integrated mapping preflight: expected refusal while base stopped (`wheeltec_robot not ready`), no mapping PID file left behind
current dataset pipeline preflight: expected refusal (5 unlabelled images, one group, empty val; training gate not entered)
integrated navigation preflight hardening: passed (map gate then expected refusal at `wheeltec_robot not ready`, no navigation PID file)
legacy 2D script cleanup hardening: passed (`bash -n`, `git diff --check`, no `pkill`/`killall`)
YOLO duration-stop smoke test: passed (3.04s, 71 frames, 23.34 FPS, exit_code=0, no lingering inference process)
YOLO new-frame/stride test: passed (stride=1: 66 frames/3.05s; stride=5: 15 frames/3.09s; both exit_code=0)
deployed illegal-parking rule integration: passed (rule smoke, parking CLI help, 1s RTSP run exit_code=0; no residual process; no accuracy claim)
Dashboard → Agent → parking arguments: passed (start/stop HTTP 200, both parking flags forwarded, final running=false)
Dashboard Server → Agent parking forwarding: passed (API start/stop HTTP 200, parking flags forwarded, final running=false, health=200)
YOLO stride-5 resource baseline: recorded (10s, 57 frames/5.64 FPS, RAM ~3.93/7.62 GB peak, per-core CPU ~86% peak, temperature ~60.2°C, no residual process)
Dashboard parking configuration UI: passed (repo/deployed Vite builds, live 8080 asset contains parking control, health=200)
parking ROI server validation: passed (out-of-range, reversed, and wrong-length zones return HTTP 422 before spawn; model remains stopped; health=200)
parking ROI schema tests: passed (3 tests)
Dashboard Server parking schema tests: passed (2 tests)
deployment parity audit: passed (inference/data/event/Agent/Server files match; board App.tsx intentional customization retained)
aggregate dependency-light unit tests: 34 passed (deployment venv auto-selected)
current-version read-only regression: passed (34 tests, Python compile, core parity; login=200, invalid ROI=422×3, model running=false, camera connected=true)
Dashboard health: HTTP 200
Dashboard camera status: HTTP 200 with local Bearer authentication
ZT6 read-only status: connected=true
```

## 当前数据集状态

当前仓库只有 2026-07-17 的 5 张未标注基线图，且只有一个场景，因此不能开始训练。下一次现场采集至少需要两个以上场景/日期组，并完成垃圾和车辆的 YOLO 标签。

## 申报材料事实素材（当前可用）

- 算法：已形成 YOLOv5 RTSP 推理、CUDA FP16、受控降帧、事件快照和“车辆检测 + 禁停 ROI + 停留时间”规则链路；当前实测证明的是工程链路和资源基线，不是垃圾/车辆识别精度。
- 平台：已形成 Jetson + ROS2 底盘/传感器接口、ZT6 可见光/红外视频接入、Dashboard、Agent/Server、云台控制和安全前置检查；模型、建图、导航均可独立停止，未授权时不会启动运动链路。
- 数据集：已确定 `garbage`、`vehicle` 两类第一版定义，具备带场景/日期/备注的 manifest、分组 train/val、YOLO 标注格式检查和训练闸门；当前仅有 5 张未标注单场景基线图，不能包装为已完成训练集。
- 待补证据：至少两个以上日期/场景组的现场数据、完整标签、训练曲线、验证集 Precision/Recall/mAP、Jetson 稳态 FPS 和误报/漏报案例。

## 下一步优先级

1. 现场采集 `gate_a_day`、`road_b_day`、`parking_c_day` 等可见光场景；
2. 用 CVAT/LabelImg/Roboflow 标注 `garbage` 和 `vehicle`；
3. 运行数据集校验并记录误标/漏标；
4. 训练 YOLOv5s 640 基线；
5. 单路 RTSP 推理 benchmark 后，再与 Dashboard、雷达/IMU、导航逐级叠加。

本次新增的底盘启动参数修复已保留在 `ros2/vehicle/turn_on_wheeltec_robot/launch/base_serial.launch.py`；实际底盘基础链路短测结束后已停止，当前不留底盘进程。
