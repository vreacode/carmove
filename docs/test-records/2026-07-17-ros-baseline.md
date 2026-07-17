# ROS 实机基线记录

## 基本信息

- 日期：2026-07-17
- 设备：Jetson，Linux 5.15.148-tegra
- 车辆：低速阿克曼底盘
- 安全状态：车轮悬空，急停可用；未进行运动测试
- 相机：`rtsp://10.16.16.10:8554/video1`

## 启动顺序

1. `/home/nvidia/Desktop/wheeltec_ros2/start_base.sh`
2. C16 雷达驱动：`lslidar_c16driver_node`
3. 点云转激光：`pointcloud_to_laserscan_node`
4. `/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy/scripts/start_mapping_integrated.sh`
5. Dashboard Agent `:9001` 和 Server `:8080`

本次没有启动导航，也没有发布 `/cmd_vel_nav` 速度指令。没有启动额外的 Yesense 驱动，避免与官方底盘提供的 `/imu/data_raw` 争用串口。

## 验收结果

健康检查命令：

```bash
cd /home/nvidia/carmove
CAMERA_RTSP_URL=rtsp://10.16.16.10:8554/video1 bash tools/ros_healthcheck.sh
```

最终结果：`pass=13 warn=0 fail=0`。

- `/wheeltec_robot`、`/odom`：通过
- `/c16/lslidar_point_cloud`：通过，约 19.9 Hz
- `/imu/data_raw`、`/imu/data`：通过，滤波 IMU 约 20.0 Hz
- `/scan`、`/map`：通过
- `/tf`、`/tf_static`：通过
- `/cmd_vel_nav`：无发布者、1 个底盘订阅者，保持安全锁定状态
- RTSP：通过，1920×1080，HEVC
- 资源：内存约 3.9/7.6 GiB 可用，温度约 50.6°C
- Agent `GET /health`：通过
- Server `GET /health`：通过

## 注意事项

SLAM 启动日志出现过一次队列丢帧提示和激光最小距离配置提示；本次健康检查中点云和 IMU 频率稳定，暂不作为阻塞问题。下一次应在安全封闭场地低速移动，验证地图是否连续、定位是否稳定，再进入 Nav2。
