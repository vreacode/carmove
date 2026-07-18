# 视觉事件规则

这一层把检测器输出转换为可展示的巡查事件，当前不依赖 ROS，也不向底盘发送指令。

## 当前接口

1. 检测器输出 `Detection(label, confidence, bbox)`；
2. `IoUTracker` 为连续帧车辆分配 `track_id`；
3. `IllegalParkingRule` 使用车辆框底部中心点判断是否进入禁停 ROI；
4. 车辆在 ROI 内持续达到 `dwell_seconds` 后生成 `illegal_parking` 事件。

垃圾检测仍直接使用 `garbage` 检测事件。第一版不把 `illegal_parking` 训练成视觉类别，因为“违停”还依赖禁停区域和停留时间。

## 接入顺序

- 先在离线视频上验证检测框、跟踪 ID 和 ROI 规则；
- 再接入 `nano_rtsp_detect.py` 的 `DETECT_JSON`/事件截图链路；
- 最后由 Agent 将事件推送给 Dashboard；
- 视觉事件永远不直接触发 `/cmd_vel_nav`。

运行单元测试：

```bash
cd /home/nvidia/carmove
PYTHONPATH=apps/nano-deploy/vision python3 -m unittest discover \
  -s apps/nano-deploy/vision -p 'test_*.py'
```
