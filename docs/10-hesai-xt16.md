# Hesai PandarXT-16 适配

当前项目已将默认建图/导航雷达切换为禾赛 PandarXT-16（铭牌上写作 PandarXT-16），使用禾赛官方 `HesaiLidar_ROS_2.0` ROS2 驱动。官方驱动支持 ROS2 Humble、PandarXT-16，并通过 UDP 发布标准 `sensor_msgs/PointCloud2`；官方配置中 XT 系列使用 UDP 点云端口和 PTC 配置端口。[官方驱动仓库](https://github.com/HesaiTechnology/HesaiLidar_ROS_2.0)

## 当前链路

```text
PandarXT-16 -> hesai_ros_driver -> /lidar_points
             -> pointcloud_to_laserscan -> /scan
             -> slam_toolbox / Nav2
```

项目默认保留原车的 `base_footprint -> laser` TF，XT-16 驱动配置中的 `transform_flag` 为 `false`。这样不会把同一份安装外参在驱动和 TF 中重复应用。雷达实际安装位置若只发生小幅变化，先用此配置验证；只有 RViz 中方向、地面高度或墙体位置明显不对时，再重新测外参。

## 网络参数

现场已将雷达配置到车辆有线网段，板卡有线网卡是 `10.16.16.2/24`：

```text
雷达 IP       10.16.16.11
子网掩码      255.255.255.0
网关          10.16.16.1
目的 IP       10.16.16.2
UDP 点云端口  2368
PTC 端口      9347
VLAN          关闭
ROS 话题      /lidar_points
ROS frame     laser
```

如果 `10.16.16.11` 后续没有数据，先在 PandarView 中读取雷达当前网络页；不要先改 TF。需要修改时同步更新：

```text
/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy/.env
/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy/config/lidar/hesai_xt16.yaml
```

禾赛官方 PandarView 说明也要求在单播模式下将主机 IP 设置为雷达的 destination IP，并使用实际 UDP 端口。[PandarView 官方说明](https://hesaitechnology.github.io/dev/docs/how_to_guides/PandarView/)

## 驱动构建

本机已经存在并编译了官方源码：

```bash
cd /home/nvidia/carmove
bash apps/nano-deploy/scripts/build_hesai_xt16_driver.sh
```

驱动安装前缀是 `/home/nvidia/ros2_ws/install/hesai_ros_driver`。如果是新设备，先按禾赛官方仓库的说明把源码放到 `/home/nvidia/ros2_ws/src/HesaiLidar_ROS_2.0-master`，并递归拉取 SDK 子模块。
项目内的构建脚本会自动补上官方源码可能遗漏的 SDK 子库安装规则，避免节点启动时出现动态库缺失。

## 启动与验证

雷达上电、网线接入板卡后：

```bash
cd /home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy
bash scripts/ensure_lidar_hesai_xt16.sh start

source /opt/ros/humble/setup.bash
source /home/nvidia/ros2_ws/install/setup.bash
ros2 topic info /lidar_points -v
ros2 topic hz /lidar_points
ros2 topic echo /lidar_points --once
```

确认点云正常后，再从网页启动建图或导航。停止雷达：

```bash
bash scripts/ensure_lidar_hesai_xt16.sh stop
```

若启动失败，先看：

```bash
sed -n '1,240p' dashboard_platform/runtime/logs/lidar_hesai_xt16.log
```

常见原因依次是：雷达 IP/目的 IP 不一致、网口未在 `10.16.16.0/24`、UDP 2368 未收到数据、角度/火焰时间校正文件路径不存在。现有 C16 驱动仍保留为历史兼容脚本，但已不再被默认建图、导航和演示流程调用。
