# 路侧垃圾与车辆模型部署

当前实机模型为 YOLO26n 检测模型，类别为 `garbage` 和 `vehicle`，训练时
使用 Ultralytics 8.4.114、输入尺寸 640。权重元数据和 SHA256 位于
`apps/nano-deploy/config/models/roadside_yolo26n_mixed_v2.json`。

## Jetson 运行方式

`nano_rtsp_detect.py` 会检查 PyTorch checkpoint 元数据：

- Ultralytics checkpoint 自动使用 Ultralytics 后端；
- 原有 helmet/fall/smoke/danger 权重继续使用 YOLOv5 后端；
- 两种后端输出相同的网页快照、事件图片和 JSON。

权重部署路径：

```text
/home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy/models/roadside_yolo26n_mixed_v2.pt
```

网页“智能感知”选择 `Roadside Garbage + Vehicle` 后启动即可。初次现场测试
建议置信度 0.25–0.35；积累误检样本后再决定正式阈值。模型启动不控制底盘。

命令行单图验收示例：

```bash
cd /home/nvidia/Desktop/wheeltec_ros2/shijue/Nano_Deploy
.venv/bin/python nano_rtsp_detect.py \
  --weights models/roadside_yolo26n_mixed_v2.pt \
  --source /path/to/test.jpg --max-frames 1 --device 0 --conf 0.25 \
  --snapshot-dir /tmp/roadside-model-test
```

权重文件按仓库规则不提交 Git；新设备部署时必须单独复制，并核对 manifest
中的大小与 SHA256。
