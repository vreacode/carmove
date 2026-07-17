export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "failed";

export type LogItem = {
  channel: "system" | "model" | "control" | string;
  level: string;
  message: string;
  timestamp: string;
  source?: string;
};

export type ModelStatus = {
  running: boolean;
  model_id?: string | null;
  weight?: string | null;
  source?: string | null;
  pid?: number | null;
  started_at?: string | null;
  command?: string[];
  view_enabled?: boolean;
};

export type MotionLastCommand = {
  command: string;
  speed: string;
  linear_x: number;
  angular_z: number;
  dry_run: boolean;
  topic: string;
  status: "acked" | "failed";
  timestamp: string;
};

export type MotionState = {
  armed: boolean;
  mode: "dry_run" | "real";
  real_publish_enabled: boolean;
  manual_override: boolean;
  nav_lockout: boolean;
  require_manual_arm: boolean;
  cmd_vel_topic: string;
  timeout_ms: number;
  max_linear_vel_safe: number;
  max_angular_vel_safe: number;
  last_command?: MotionLastCommand | null;
  last_error?: string | null;
};

export type BaseStatus = {
  running: boolean;
  started_by_agent: boolean;
  pid?: number | null;
  wheeltec_robot_online: boolean;
  cmd_vel_subscriber_online: boolean;
  odom_online: boolean;
  last_error?: string | null;
};

export type SystemStatus = {
  agent_online: boolean;
  board_online: boolean;
  board_name?: string;
  current_video_source?: string | null;
  current_video_mode?: "visible_raw" | "ir_raw" | "annotated";
  current_model?: string | null;
  current_map_name?: string | null;
  mapping_running?: boolean;
  navigation_running?: boolean;
  rviz_available?: boolean;
  rviz_running?: boolean;
  base_status?: BaseStatus | null;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  gpu_percent?: number | null;
  last_heartbeat?: string;
  available_models?: Array<{ id: string; label: string; weight: string }>;
  model_status?: ModelStatus;
  motion_state?: MotionState | null;
  allow_mjpeg_fallback?: boolean;
  lidar_online?: boolean;
  imu_online?: boolean;
  pointcloud_hz?: number | null;
  imu_hz?: number | null;
  point_count?: number;
  sensor_error?: string | null;
  lidar_to_base_translation?: string;
  lidar_to_base_rotation_rpy?: string;
  imu_to_base_rotation_rpy?: string;
  car_model_forward_axis?: string;
  car_model_up_axis?: string;
  pointcloud_history_seconds?: number;
  error?: string;
};

export type StreamStats = {
  fps?: number;
  bitrateKbps?: number;
  width?: number;
  height?: number;
  rttMs?: number;
  frameAgeMs?: number;
  frozen?: boolean;
};

export type SensorFrame = {
  type: "sensor_frame";
  timestamp: number;
  seq: number;
  lidar_online: boolean;
  imu_online: boolean;
  pointcloud_hz?: number | null;
  imu_hz?: number | null;
  point_count: number;
  points: number[];
  imu?: {
    orientation?: { x: number; y: number; z: number; w: number };
    angular_velocity?: { x: number; y: number; z: number };
    linear_acceleration?: { x: number; y: number; z: number };
  };
  robot_pose?: {
    x: number;
    y: number;
    yaw: number;
    frame_id: string;
    source: string;
  } | null;
  error?: string | null;
};

export type PoseFrame = {
  type: "pose_frame";
  timestamp: number;
  seq: number;
  pose?: {
    x: number;
    y: number;
    yaw: number;
    frame_id: string;
    source: string;
  } | null;
  pose_source?: string | null;
  error?: string | null;
};

export type MapEntry = {
  name: string;
  yaml_path: string;
  image_path: string;
  updated_at: string;
};

export type MapMetadata = {
  name: string;
  yaml_path: string;
  image_path: string;
  resolution: number;
  origin: number[];
  negate: number;
  occupied_thresh: number;
  free_thresh: number;
  width?: number | null;
  height?: number | null;
};

export type MediaStatus = {
  enabled: boolean;
  gallery_enabled: boolean;
  recording_running: boolean;
  recording_mode?: "visible_raw" | "ir_raw" | null;
  recording_filename?: string | null;
  recording_started_at?: string | null;
  recording_backend: string;
  recording_output_dir: string;
  snapshot_output_dir: string;
  last_error?: string | null;
};

export type MediaItem = {
  storage_kind: "recording" | "snapshot" | "event";
  media_type: "video" | "image";
  filename: string;
  created_at: string;
  size_bytes: number;
};
