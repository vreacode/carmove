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

## 测试结果

```text
SIYI protocol tests: 7 passed
vision event-rule tests: 4 passed
dataset-tool tests: 4 passed
frontend build: passed
base preflight: pass=8 warn=0 fail=0
base runtime smoke test: passed (serial, odom, imu, tf, ekf; no cmd_vel publisher)
Dashboard health: HTTP 200
ZT6 read-only status: connected=true
```

## 当前数据集状态

当前仓库只有 2026-07-17 的 5 张未标注基线图，且只有一个场景，因此不能开始训练。下一次现场采集至少需要两个以上场景/日期组，并完成垃圾和车辆的 YOLO 标签。

## 下一步优先级

1. 现场采集 `gate_a_day`、`road_b_day`、`parking_c_day` 等可见光场景；
2. 用 CVAT/LabelImg/Roboflow 标注 `garbage` 和 `vehicle`；
3. 运行数据集校验并记录误标/漏标；
4. 训练 YOLOv5s 640 基线；
5. 单路 RTSP 推理 benchmark 后，再与 Dashboard、雷达/IMU、导航逐级叠加。

本次新增的底盘启动参数修复已保留在 `ros2/vehicle/turn_on_wheeltec_robot/launch/base_serial.launch.py`；实际底盘基础链路短测结束后已停止，当前不留底盘进程。
