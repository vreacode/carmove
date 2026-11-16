import type { SystemStatus } from "./types";

export type AlgorithmCategory = "vision" | "mapping" | "navigation";
export type Algorithm = {
  id: string;
  name: string;
  family: string;
  category: AlgorithmCategory;
  summary: string;
  input: string;
  output: string;
  requirements: string[];
  boundary: string;
  modelId?: string;
  weight?: string;
  mappingBackend?: "glim" | "fastlio2" | "slam_toolbox";
  configured: boolean;
  running: boolean;
};

export const categoryLabels: Record<AlgorithmCategory, string> = {
  vision: "视觉识别",
  mapping: "定位建图",
  navigation: "自主导航",
};

type ModelDescription = Pick<Algorithm, "name" | "family" | "summary" | "output" | "boundary">;
const modelDescriptions: Record<string, ModelDescription> = {
  helmet: {
    name: "安全帽检测", family: "YOLO · 目标检测",
    summary: "识别画面中的安全帽相关目标，用于人员穿戴场景演示。",
    output: "helmet / head 目标框与置信度；检测画面与事件快照",
    boundary: "类别以权重实际输出为准。遮挡、小目标和逆光会影响识别；未完成现场精度统计。",
  },
  fall: {
    name: "跌倒检测", family: "YOLO · 目标检测",
    summary: "识别疑似跌倒目标，为现场人员状态巡查提供画面提示。",
    output: "Fall Detected / Walking / Sitting 目标框与置信度",
    boundary: "蹲坐、躺卧与遮挡可能造成误判，结果需人工复核。",
  },
  smoke: {
    name: "吸烟与烟雾检测", family: "YOLO · 目标检测",
    summary: "检测香烟、人员、烟雾和电子烟相关目标，辅助巡查。",
    output: "Cigarette / Person / Smoke / Vape 目标框与置信度",
    boundary: "小目标、雾气和光照可能影响结果，现场告警需要人工确认。",
  },
  danger: {
    name: "安全帽检测（Danger 权重）", family: "YOLO · 历史模型",
    summary: "保留现有 danger 模型入口，当前板端权重识别安全帽与头部。",
    output: "helmet / head 目标框与置信度",
    boundary: "已核对本机 danger.pt 的类别，与安全帽模型相同；尚无独立危险行为识别的验证证据。",
  },
  roadside: {
    name: "垃圾与车辆检测", family: "YOLO26n · 目标检测",
    summary: "识别道路场景中的垃圾与车辆，为巡查事件提供视觉输入。",
    output: "garbage / vehicle 目标框、置信度与事件快照",
    boundary: "违停还需配置区域与停留时间；移动相机会影响区域判断，未完成量化精度验收。",
  },
};

const pipelines: Omit<Algorithm, "configured" | "running">[] = [
  {
    id: "glim", name: "GLIM 三维建图", family: "激光雷达 · 惯性融合", category: "mapping",
    summary: "融合激光雷达与 IMU 数据，构建室外三维地图并保留轨迹。",
    input: "XT-16 三维点云 + IMU", output: "三维地图、轨迹；后续可投影为导航栅格",
    requirements: ["雷达、IMU 数据正常", "传感器外参和时间同步正确", "在建图页面检查采集与保存配置"],
    boundary: "建图质量需结合数据检查；已有学院楼轨迹，无外部真值精度报告。", mappingBackend: "glim",
  },
  {
    id: "fastlio2", name: "FAST-LIO2 三维建图", family: "激光雷达 · 惯性里程计", category: "mapping",
    summary: "通过现有室外建图入口运行激光惯性里程计与地图构建。",
    input: "三维点云 + IMU", output: "里程计与三维地图",
    requirements: ["雷达、IMU 及对应驱动可用", "外参与点云字段符合配置", "启动前在建图页面检查后端"],
    boundary: "保留了集成入口，未完成与 GLIM 在同场景的严格对比验收。", mappingBackend: "fastlio2",
  },
  {
    id: "slam_toolbox", name: "室内二维建图", family: "SLAM Toolbox · 2D SLAM", category: "mapping",
    summary: "使用现有室内建图流程生成二维占据栅格地图。",
    input: "二维扫描 + 里程计 + TF", output: "二维栅格地图与定位变换",
    requirements: ["扫描、里程计与 TF 链路正常", "底盘与场地具备建图条件", "在建图页面选择室内 2D"],
    boundary: "地图需保存并检查障碍与可通行区域，启动建图不代表导航验证完成。", mappingBackend: "slam_toolbox",
  },
  {
    id: "nav2", name: "阿克曼单点导航", family: "Nav2 · Hybrid A* + RPP", category: "navigation",
    summary: "结合已保存地图、实时定位和底盘控制，执行单目标导航。",
    input: "地图 + 定位 + 障碍数据 + 目标位姿", output: "全局路径、控制指令与目标执行状态",
    requirements: ["底盘、定位与障碍感知正常", "已加载地图并设置初始位姿", "在导航页面检查场地与目标，再发送目标"],
    boundary: "已有单点成功记录；长路线曾在弯道卡路牙，连续弯道与整圈巡航仍需验证。",
  },
];

/** Model entries come from the device configuration, not a fixed list of deployed weights. */
export function buildAlgorithmCatalog(status: SystemStatus | null): Algorithm[] {
  const configuredModels = status?.available_models ?? [];
  const configuredIds = new Set(configuredModels.map((model) => model.id));
  const models = [
    ...configuredModels,
    ...Object.keys(modelDescriptions).filter((id) => !configuredIds.has(id)).map((id) => ({ id, label: id, weight: "" })),
  ];
  const online = !!status?.agent_online;
  const vision: Algorithm[] = models.map((model) => {
    const description = modelDescriptions[model.id] ?? {
      name: model.label || model.id, family: "设备配置模型",
      summary: "设备已配置的视觉模型，可加载到实时监控中查看输出。",
      output: "检测目标框、类别与置信度", boundary: "用途和类别以对应权重的实际输出为准。",
    };
    return {
      ...description, id: `model:${model.id}`, category: "vision", modelId: model.id,
      weight: model.weight, configured: configuredIds.has(model.id),
      running: online && !!status?.model_status?.running && status.model_status.model_id === model.id,
      input: "可见光视频流（可在实时监控修改）",
      requirements: ["设备在线，模型权重可读取", "摄像头视频源可连接", "在实时监控启动模型并切换到检测结果"],
    };
  });
  return [...vision, ...pipelines.map((entry): Algorithm => ({
    ...entry, configured: true,
    running: online && (entry.category === "navigation"
      ? !!status?.navigation_running
      : !!status?.mapping_running && status.mapping_backend === entry.mappingBackend),
  }))];
}
