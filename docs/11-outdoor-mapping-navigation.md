# 室外建图与导航路线

## 当前结论

室外建图采用双后端，不强制绑定 FAST-LIO2：

- **GLIM 1.2.2（默认候选）**：直接读取 XT-16 原始 `/lidar_points` 和 Yesense `/imu/data_raw`，提供局部子图、隐式回环与全局因子图优化；
- **FAST-LIO2（基线/保底）**：通过 `hesai_fastlio_adapter` 转换逐点时间字段，继续提供轻量实时 LIO 和 PCD；
- **slam_toolbox + Nav2**：保留为室内二维链路，不与室外 3D 后端同时运行。

```text
                         ┌─> GLIM ─────────────> 图优化地图 + TUM 轨迹
XT-16 /lidar_points ─────┤
                         └─> XT-16 adapter ────> FAST-LIO2 ─> PCD + 轨迹

Yesense /imu/data_raw ───┴─────────────────────> 两个后端共用
```

GLIM 已使用官方 CUDA 12.6 ARM64 二进制隔离安装在
`/home/nvidia/glim_ws/local_root`，不修改 apt 源、不写系统目录，也不需要
sudo。此平台为 Jetson Orin、Ubuntu 22.04、ROS 2 Humble、CUDA 12.6，与
GLIM 官方测试平台一致。

网页“建图导航 → 室外 3D”可直接选择 **GLIM（推荐）** 或
**FAST-LIO2（基线）**。两者都不会自动启动底盘或驱动车辆。

## 已完成的实机验证

2026-07-30 在车辆静止、不开底盘的条件下完成：

1. 原始 rosbag：5.25 秒内记录 47 帧 XT-16 点云和 983 帧 Yesense IMU；
2. GLIM 离线：输出 36 个有效位姿，静止累计位移约 1 mm，峰值内存约
   245 MiB，并保存完整因子图、子图和回环前后轨迹；
3. FAST-LIO2 离线：同一 rosbag 正常初始化并输出轨迹；
4. GLIM 在线：最初发现默认 BEST_EFFORT 小队列会在预处理波动时静默
   丢点云帧；
5. 将 LiDAR/IMU 订阅改为与驱动一致的 RELIABLE 深队列后，15 秒输出
   157 个位姿，LiDAR 间隙、IMU 间隙和 LiDAR/IMU 时差告警均为 0，并
   正常保存地图；
6. 外场录包启动闸门实测通过：只有连续采到 XT-16 10.0 Hz、Yesense
   200.0 Hz，确认 `x/y/z/intensity/ring/timestamp` 字段、时间戳单调且
   rosbag 文件已经增长后，网页才显示“录制中”；
7. 6.49 秒验证包记录 65 帧点云和 823 帧 `/imu/data_raw`，停止后
   `metadata.yaml` 完整，包大小约 104 MiB。

短时间静止测试只能证明链路与时间处理正确，不能替代运动闭环、外参和
绝对精度验收。

## 主要文件

- `apps/nano-deploy/config/outdoor/glim/`：XT-16 + Yesense 的 GLIM 配置；
- `apps/nano-deploy/config/outdoor/glim_local_setup.bash`：隔离安装环境；
- `apps/nano-deploy/config/outdoor/glim_outdoor.rviz`：GLIM 在线 RViz；
- `apps/nano-deploy/scripts/install_glim_local.sh`：零 sudo、带 SHA256
  校验的可重复安装脚本；
- `apps/nano-deploy/scripts/start_glim_mapping.sh`：GLIM 自检、启动、
  停止并保存；
- `apps/nano-deploy/scripts/record_outdoor_sensors.sh`：算法无关的现场
  rosbag；
- `apps/nano-deploy/scripts/verify_outdoor_streams.py`：录制前同时验证
  XT-16/IMU 频率、字段、frame_id、点数与时间戳；
- `apps/nano-deploy/scripts/analyze_outdoor_bag.py`：录制停止后自动检查
  Topic 频率、时间戳、点数、雷达丢包、轮速路程、累计转角和起止静止段，
  同时生成 `quality_report.json` 与 `quality_report.md`；
- `apps/nano-deploy/scripts/benchmark_outdoor_backends.sh`：顺序运行
  GLIM/FAST-LIO2 A/B，并在本机导出 GLIM 优化点云与保守二维投影；
- `apps/nano-deploy/scripts/export_glim_map.sh`：将 GLIM 图优化目录可靠导出
  为标准二进制 PLY，并规避上游导出后 Viewer 不退出的问题；
- `apps/nano-deploy/scripts/project_pointcloud_to_nav2.py`：拟合地面平面，按
  高度带提取障碍，输出 Nav2 `pgm/yaml` 与投影诊断报告；
- `apps/nano-deploy/scripts/export_glim_nav2_map.sh`：串联上述两个步骤；
- `apps/nano-deploy/scripts/build_glim_export_overlay.sh`：以单线程 Release
  方式构建仅供离线导出的 GLIM 覆盖层，不替换在线 CUDA 建图环境；
- `apps/nano-deploy/scripts/summarize_outdoor_benchmark.py`：闭环与资源
  摘要；
- `ros2/fastlio2/hesai_fastlio_adapter/`：FAST-LIO2 所需的 XT-16
  时间字段适配；
- `apps/nano-deploy/scripts/start_outdoor_mapping.sh`：FAST-LIO2 基线
  启停。

输出位置：

```text
GLIM:      /home/nvidia/Desktop/wheeltec_ros2/maps/outdoor/glim/<时间戳>/
FAST-LIO2: /home/nvidia/Desktop/wheeltec_ros2/maps/outdoor/<时间戳>.pcd
rosbag:    /home/nvidia/Desktop/wheeltec_ros2/bags/outdoor/<时间戳>/
A/B结果:   /home/nvidia/Desktop/wheeltec_ros2/benchmarks/outdoor/<运行时间>/
```

## 下午外场：推荐只采一次

优先使用网页“室外 3D → 记录 A/B 原始数据”。流程：

1. 上电后把车放稳，点击“记录 A/B 原始数据”；
2. 界面显示“正在验证雷达与 IMU”期间不要移动；本机实测约 15 秒；
3. 只有看到绿色提示“数据正在持续落盘，可以开始低速行驶”后，才开始
   计算静止时间；
4. 继续保持完全静止 10 秒，让 IMU 偏置可观测；
5. 人工低速行驶，依次包含直线、左右转、开阔区和有固定结构物的路段；
6. 最后回到起点附近，形成闭环；
7. 停车后再静止 5 秒，然后点击“停止原始数据记录”；
8. 等待停止校验返回包大小与 Topic 计数后再断电；
9. 不要同时启动 GLIM、FAST-LIO2 或室内建图。

停止后网页会显示三级质量结论：

- `PASS`：传感器完整，且路线不少于 120 秒、15 米、累计转角 45°，
  起止静止段均不少于 5 秒；
- `SENSOR_ONLY`：传感器数据合格，但路线覆盖不足，只适合链路测试；
- `FAIL`：频率、frame、时间戳、点云字段、点数或雷达丢包未通过，建议重采。

命令行等价操作：

```bash
cd /home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy
bash scripts/record_outdoor_sensors.sh check
bash scripts/record_outdoor_sensors.sh start
bash scripts/record_outdoor_sensors.sh status
bash scripts/record_outdoor_sensors.sh stop
```

录制完成后运行同包对比：

```bash
bash scripts/benchmark_outdoor_backends.sh \
  /home/nvidia/Desktop/wheeltec_ros2/bags/outdoor/<数据包目录> both
```

`summary.md` 会列出回环前 GLIM、回环后 GLIM 和 FAST-LIO2 的位姿数、
路径长度、起终点平移差、航向差及资源占用。只有车辆确实回到起点附近时，
闭合误差才有比较意义；没有真值设备时它仍不是绝对精度。

GLIM 完成后还会在 `glim/nav2_map/` 生成：

```text
optimized_map.ply
glim_nav2_map.pgm
glim_nav2_map.yaml
glim_nav2_map.projection.json
```

投影报告的 `READY_FOR_REVIEW` 只表示数据规模足以人工检查，不代表已经
允许自主运动；`PROTOTYPE_ONLY` 表示点数、已知区域或地面连通范围不足。
可通过 `GLIM_EXPORT_NAV2=false` 临时关闭自动投影。

## 直接在线建图

网页中选择算法后点击启动即可。命令行操作如下。

GLIM：

```bash
cd /home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy
bash scripts/start_glim_mapping.sh check
bash scripts/start_glim_mapping.sh start
bash scripts/start_glim_mapping.sh status
bash scripts/start_glim_mapping.sh stop
```

GLIM 在优雅停止时一次性保存完整图优化目录，所以网页只提供
“结束并保存 GLIM”，不把中途快照伪装成完整地图。

FAST-LIO2：

```bash
bash scripts/start_outdoor_mapping.sh check
bash scripts/start_outdoor_mapping.sh start
bash scripts/start_outdoor_mapping.sh save
bash scripts/start_outdoor_mapping.sh stop
```

## 三维地图到二维地图的当前进度

2026-07-31 已完成 GLIM 官方优化点云导出和第一版保守二维投影。本机短路线
实测导出 2,042 个点，生成 103 × 413、0.10 m/px 的 Nav2 地图和诊断报告；
由于短路线只有约 1 米，报告正确标记为 `PROTOTYPE_ONLY`。该结果证明转换
链路可用，不代表短路线地图可用于导航。

单独转换已有 GLIM 地图：

```bash
cd /home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy
bash scripts/export_glim_nav2_map.sh \
  /path/to/glim/map /path/to/output/nav2_map outdoor_map
```

默认将地面平面 ±0.15 m 视作地面，将地面以上 0.20–2.00 m 视作障碍，
地图外和未观测区域保持 unknown。大坡度、台阶、草地和悬空障碍仍必须结合
实际场地查看 PGM 与点云后调整阈值。

## 为什么现在仍不能直接自主导航

Nav2 的全局规划与控制仍需要二维 OccupancyGrid/Costmap。GLIM 图优化地图
或 FAST-LIO2 PCD 都不能直接替代：

1. 可通行地面与障碍的二维投影；
2. 车辆重启后对已有 3D 地图的全局重定位；
3. 与 `map → odom → base_link` 一致的连续 TF；
4. 经外场验证的局部代价地图、规划器和控制器。

因此当前“室外自主导航”仍保持禁用。推荐下一阶段按顺序推进：

1. 用下一次较长闭环数据复核主后端、LiDAR–IMU 外参和二维投影；
2. 人工检查二维地图的地面连通、玻璃/草地/坡道和悬空障碍；
3. 接入开源 NDT/GICP 先验地图定位，完成跨重启重定位；
4. 再接 Nav2 局部规划与低速有人看护场测；
5. Yesense GNSS 恢复有效定位后，再评估
   `robot_localization/navsat_transform_node` 的大范围约束；
6. 完成急停、失联停车和回归测试后，才开放室外自主目标点。

当前外参由原车 `base_footprint → laser` 配置换算得到。雷达安装位置相近
不代表可以跳过复核；如果直线往返出现稳定双墙，应优先检查时间、外参和
安装刚性，不能靠放宽匹配参数掩盖。

参考上游：

- [GLIM](https://github.com/koide3/glim)
- [FAST-LIO2](https://github.com/hku-mars/FAST_LIO)
- [Nav2 Voxel Layer](https://docs.nav2.org/configuration/packages/costmap-plugins/voxel.html)
- [robot_localization navsat_transform](https://docs.ros.org/en/noetic/api/robot_localization/html/navsat_transform_node.html)
