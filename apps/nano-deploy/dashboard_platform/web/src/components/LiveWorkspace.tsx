import { useRef, useState } from "react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  Battery50Icon,
  BoltIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  HandRaisedIcon,
  LockClosedIcon,
  LockOpenIcon,
  PauseIcon,
  PlayIcon,
  RadioIcon,
  ShieldCheckIcon,
  StopIcon,
  VideoCameraIcon,
} from "./FlClashIcons";
import { classNames } from "../lib";
import type { ConnectionState, SystemStatus } from "../types";
import { VideoStream } from "./VideoStream";
import { ModelSettingsDialog } from "./ModelSettingsDialog";
import { SegmentedControl } from "./SegmentedControl";
import { ResourceSummary } from "./ResourceTrends";
import type { ResourceSample } from "../hooks/useResourceHistory";

type Speed = "low" | "medium" | "high";
type Steering = "center" | "left" | "right";
type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type LiveWorkspaceProps = {
  token: string;
  status: SystemStatus | null;
  error: string;
  resourceHistory: ResourceSample[];
  video: {
    mode: "visible_raw" | "ir_raw" | "annotated";
    setMode: (mode: "visible_raw" | "annotated") => void;
    useFallback: boolean;
    toggleFallback: () => void;
    onStateChange: (state: ConnectionState) => void;
  };
  model: {
    selected: string;
    choose: (id: string) => void;
    source: string;
    setSource: (source: string) => void;
    pending: string;
    run: (action: "start" | "restart") => void;
    stop: () => void;
    parkingEnabled: boolean;
    setParkingEnabled: (enabled: boolean) => void;
    parkingZone: string;
    setParkingZone: (zone: string) => void;
    parkingDwell: string;
    setParkingDwell: (dwell: string) => void;
  };
  control: {
    speed: Speed;
    setSpeed: (speed: Speed) => void;
    pending: boolean;
    armPending: boolean;
    overridePending: boolean;
    cruisePending: string;
    cruiseActive: boolean;
    cruiseSteering: Steering;
    blocked: boolean;
    hint: string;
    commandState: string;
    send: (command: string) => void;
    setArmed: (armed: boolean) => void;
    setOverride: (enabled: boolean) => void;
    startCruise: () => void;
    stopCruise: () => void;
    steerCruise: (direction: Steering) => void;
    emergencyStop: () => void;
  };
};

const speedOptions: { id: Speed; label: string }[] = [
  { id: "low", label: "低速" },
  { id: "medium", label: "中速" },
  { id: "high", label: "高速" },
];

function Signal({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "good" | "warn" | "neutral" | "danger";
}) {
  return (
    <span className={`live-signal live-signal--${tone}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}

function Summary({
  icon: Glyph,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: Icon;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className={`live-summary-card live-summary-card--${tone}`}>
      <div className="live-summary-label">
        <Glyph aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong title={value}>{value}</strong>
      <span className="live-summary-detail">{detail}</span>
    </div>
  );
}

export function LiveWorkspace({
  token,
  status,
  error,
  video,
  model,
  control,
  resourceHistory,
}: LiveWorkspaceProps) {
  const settingsEntry = useRef<HTMLButtonElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsEntry.current?.focus());
  }
  const [settingsSaved, setSettingsSaved] = useState(false);
  const running = !!status?.model_status?.running;
  const changingModel = running && status?.model_status?.model_id !== model.selected;
  const modelAvailable = !!status?.agent_online && !!status.available_models?.some((entry) => entry.id === model.selected);
  const motion = status?.motion_state;
  const battery = status?.battery_status;
  const batteryPercent =
    battery?.available && battery.percentage != null
      ? `${Math.round(battery.percentage)}%`
      : "暂无数据";
  const modelLabel =
    status?.available_models?.find(
      (entry) => entry.id === status?.model_status?.model_id,
    )?.label ||
    status?.model_status?.model_id ||
    "未加载";
  const commandLabel: Record<string, string> = {
    idle: "暂无命令",
    sent: "发送中",
    acked: "已确认",
    failed: "发送失败",
  };
  const lastCommand = motion?.last_command;

  return (
    <div id="section-live" className="live-workspace">
      <div className="live-summary" aria-label="设备概览">
        <Summary
          icon={RadioIcon}
          label="设备连接"
          value={status?.agent_online ? "设备在线" : "设备离线"}
          detail={status?.board_name || "Jetson Nano · 车载计算平台"}
          tone={status?.agent_online ? "good" : "neutral"}
        />
        <ResourceSummary
          metric="cpu"
          status={status}
          samples={resourceHistory}
        />
        <ResourceSummary
          metric="memory"
          status={status}
          samples={resourceHistory}
        />
        <Summary
          icon={Battery50Icon}
          label="车辆电池"
          value={batteryPercent}
          detail={
            battery?.available && battery.voltage != null
              ? `${battery.voltage.toFixed(1)} V${battery.charging ? " · 充电中" : " · 实时电压"}`
              : "等待电池遥测"
          }
          tone={battery?.low ? "warn" : "neutral"}
        />
      </div>

      {error && (
        <div role="alert" className="live-error">
          <ExclamationTriangleIcon aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="live-layout">
        <div className="live-main-column">
          <section
            className="live-card live-monitor"
            aria-labelledby="live-monitor-title"
          >
            <header className="live-card-heading">
              <div className="live-card-title">
                <span className="live-heading-icon">
                  <VideoCameraIcon aria-hidden="true" />
                </span>
                <div>
                  <h2 id="live-monitor-title">现场画面</h2>
                  <p>可见光与红外</p>
                </div>
              </div>
              <button
                type="button"
                className={classNames(
                  "live-text-button",
                  video.useFallback && "is-active",
                )}
                onClick={video.toggleFallback}
                aria-pressed={video.useFallback}
                title="切换实时视频与兼容视频连接方式"
              >
                <ArrowPathIcon aria-hidden="true" />
                {video.useFallback ? "恢复实时连接" : "兼容连接"}
              </button>
            </header>
            <div className="live-feed-toolbar">
              <SegmentedControl label="主画面模式" value={video.mode === "annotated" ? "annotated" : "visible_raw"}
                options={[{ value: "visible_raw", label: "可见光" }, { value: "annotated", label: "检测结果", disabled: !running }]}
                onChange={video.setMode} />
              <Signal tone={status?.model_status?.running ? "good" : "neutral"}>
                {status?.model_status?.running
                  ? `${modelLabel} · 推理中`
                  : "模型未启动"}
              </Signal>
            </div>
            <div className="live-feeds">
              <VideoStream
                mode={video.mode}
                token={token}
                useFallback={video.useFallback}
                onStateChange={video.onStateChange}
                presentation="console"
              />
              <VideoStream
                mode="ir_raw"
                token={token}
                useFallback={video.useFallback}
                presentation="console"
              />
            </div>
            <footer className="live-monitor-footer">
              <span>
                <span className="live-channel-dot" />
                摄像头画面
              </span>
              <span>可点击画面右下角放大</span>
            </footer>
          </section>

          <section
            className="live-card live-inference"
            aria-labelledby="live-inference-title"
          >
            <header className="live-card-heading">
              <div className="live-card-title">
                <span className="live-heading-icon">
                  <CpuChipIcon aria-hidden="true" />
                </span>
                <div>
                  <h2 id="live-inference-title">目标检测</h2>
                  <p>选择模型后启动检测</p>
                </div>
              </div>
              <a href="#algorithms" className="live-text-button">
                浏览算法库
                <ArrowUpRightIcon aria-hidden="true" />
              </a>
            </header>
            <div className="live-model-controls">
              <label className="live-model-field">
                <span>检测模型</span>
                <select
                  aria-label="检测模型"
                  value={model.selected}
                  onChange={(event) => model.choose(event.target.value)}
                >
                  {(status?.available_models ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="live-model-actions">
                <button type="button" className="live-button live-button--primary"
                  onClick={() => model.run(running ? "restart" : "start")}
                  disabled={!!model.pending || !modelAvailable}>
                  {running ? <ArrowPathIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
                  {model.pending === "start" ? "启动中…" : model.pending === "restart" ? "切换中…" : changingModel ? "切换模型" : running ? "重启模型" : "启动模型"}
                </button>
                <button type="button" className="live-button live-button--quiet" onClick={model.stop} disabled={!!model.pending || !running || !status?.agent_online}>
                  <PauseIcon aria-hidden="true" />{model.pending === "stop" ? "停止中…" : "停止模型"}
                </button>
              </div>
            </div>
            {changingModel && <p role="status" className="live-model-notice">当前运行 {modelLabel}，点击“切换模型”应用新选择。</p>}
            {!modelAvailable && <p className="control-unavailable">{status?.agent_online ? "设备未配置所选模型，请在算法库中选择可用模型。" : "设备离线，连接后可启动检测。"}</p>}
            <div className="live-model-metadata">
              <Signal tone={status?.model_status?.running ? "good" : "neutral"}>
                {status?.model_status?.running ? "运行中" : "未运行"}
              </Signal>
              <span>
                模型 <b>{status?.model_status?.model_id || "—"}</b>
              </span>
              <span>
                进程 <b>{status?.model_status?.pid || "—"}</b>
              </span>
              <span>
                启动于{" "}
                <b>
                  {status?.model_status?.started_at
                    ? new Date(
                        status.model_status.started_at,
                      ).toLocaleTimeString()
                    : "—"}
                </b>
              </span>
            </div>
            <button type="button" ref={settingsEntry} aria-haspopup="dialog" className="settings-entry" onClick={() => setSettingsOpen(true)} disabled={!!model.pending}>
              <span><strong>检测设置</strong><small>{model.parkingEnabled ? "违停判定已启用" : "视频输入源、违停判定"}</small></span><ChevronRightIcon aria-hidden="true" />
            </button>
            {settingsSaved && <p role="status" className="settings-saved">设置已保存，下次启动或切换模型时生效。</p>}
            {settingsOpen && <ModelSettingsDialog initialValue={{ source: model.source, parkingEnabled: model.parkingEnabled, zone: model.parkingZone, dwell: model.parkingDwell }}
              onClose={closeSettings} onSave={(settings) => {
                model.setSource(settings.source); model.setParkingEnabled(settings.parkingEnabled);
                model.setParkingZone(settings.zone); model.setParkingDwell(settings.dwell);
                closeSettings(); setSettingsSaved(true);
              }} />}
          </section>
        </div>

        <section
          className="live-card live-control"
          aria-labelledby="live-control-title"
        >
          <header className="live-card-heading">
            <div className="live-card-title">
              <span className="live-heading-icon">
                <BoltIcon aria-hidden="true" />
              </span>
              <div>
                <h2 id="live-control-title">车辆操控</h2>
                <p>
                  {!motion
                    ? "等待控制状态"
                    : motion.mode === "real"
                      ? "实车模式 · 手动驾驶"
                      : "模拟模式 · 手动驾驶"}
                </p>
              </div>
            </div>
            <Signal tone={motion?.armed ? "good" : "neutral"}>
              {!motion ? "等待状态" : motion.armed ? "已解锁" : "已锁定"}
            </Signal>
          </header>
          <div className="live-control-permissions">
            <button
              type="button"
              className="live-button"
              disabled={control.armPending || !motion}
              onClick={() => control.setArmed(!motion?.armed)}
            >
              {motion?.armed ? (
                <LockOpenIcon aria-hidden="true" />
              ) : (
                <LockClosedIcon aria-hidden="true" />
              )}
              {control.armPending
                ? "处理中"
                : motion?.armed
                  ? "锁定控制"
                  : "解锁控制"}
            </button>
            <button
              type="button"
              className="live-button live-button--quiet"
              disabled={
                control.overridePending ||
                !motion ||
                (!status?.navigation_running && !motion?.manual_override) ||
                (!!motion &&
                  motion.require_manual_arm &&
                  !motion.armed &&
                  !motion.manual_override)
              }
              onClick={() => control.setOverride(!motion?.manual_override)}
            >
              <HandRaisedIcon aria-hidden="true" />
              {control.overridePending
                ? "处理中"
                : motion?.manual_override
                  ? "取消人工接管"
                  : "启用人工接管"}
            </button>
          </div>
          <div className="live-speed-row">
            <span>速度档位</span>
            <SegmentedControl label="速度档位" value={control.speed} disabled={control.cruiseActive}
              options={speedOptions.map((option) => ({ value: option.id, label: option.label }))} onChange={control.setSpeed} />
          </div>
          <div className="live-driving-surface">
            <div className="live-direction-pad" aria-label="方向操控">
              <span />
              <button
                type="button"
                title="前进"
                aria-label="前进"
                disabled={
                  control.pending || control.cruiseActive || control.blocked
                }
                onClick={() => control.send("forward")}
              >
                <ChevronUpIcon />
                <kbd>W</kbd>
              </button>
              <span />
              <button
                type="button"
                title="左转"
                aria-label="左转"
                disabled={
                  control.pending || control.cruiseActive || control.blocked
                }
                onClick={() => control.send("left")}
              >
                <ChevronLeftIcon />
                <kbd>A</kbd>
              </button>
              <button
                type="button"
                className="live-direction-stop"
                title="停止"
                aria-label="停止"
                disabled={control.pending || control.cruisePending !== ""}
                onClick={() =>
                  control.cruiseActive
                    ? control.stopCruise()
                    : control.send("stop")
                }
              >
                <StopIcon />
              </button>
              <button
                type="button"
                title="右转"
                aria-label="右转"
                disabled={
                  control.pending || control.cruiseActive || control.blocked
                }
                onClick={() => control.send("right")}
              >
                <ChevronRightIcon />
                <kbd>D</kbd>
              </button>
              <span />
              <button
                type="button"
                title="后退"
                aria-label="后退"
                disabled={
                  control.pending || control.cruiseActive || control.blocked
                }
                onClick={() => control.send("backward")}
              >
                <ChevronDownIcon />
                <kbd>S</kbd>
              </button>
              <span />
            </div>
            <p className="live-keyboard-hint">
              W / A / S / D 控制方向 <span>·</span> 空格停止
            </p>
          </div>
          <p className="live-control-hint">
            <ShieldCheckIcon aria-hidden="true" />
            <span>{control.hint}</span>
          </p>
          <button
            type="button"
            className="live-emergency"
            disabled={control.pending}
            onClick={control.emergencyStop}
          >
            <span>
              <ExclamationTriangleIcon aria-hidden="true" />
              紧急停车
            </span>
            <span>
              立即停止
              <StopIcon aria-hidden="true" />
            </span>
          </button>

          <div className="live-cruise">
            <div className="live-cruise-heading">
              <div>
                <h3>匀速前进</h3>
                <p>
                  {control.cruiseActive
                    ? `正在持续行驶 · ${control.cruiseSteering === "left" ? "左修正" : control.cruiseSteering === "right" ? "右修正" : "直行中"}`
                    : "按当前档位持续行驶"}
                </p>
              </div>
              <button
                type="button"
                className={classNames(
                  "live-cruise-button",
                  control.cruiseActive && "is-running",
                )}
                aria-label={
                  control.cruiseActive ? "停止匀速前进" : "开始匀速前进"
                }
                onClick={() =>
                  control.cruiseActive
                    ? control.stopCruise()
                    : control.startCruise()
                }
                disabled={
                  control.cruisePending !== "" ||
                  !motion ||
                  (!control.cruiseActive && control.blocked)
                }
              >
                {control.cruisePending ? (
                  <ArrowPathIcon aria-hidden="true" />
                ) : control.cruiseActive ? (
                  <PauseIcon aria-hidden="true" />
                ) : (
                  <ArrowRightIcon aria-hidden="true" />
                )}
              </button>
            </div>
            {control.cruiseActive && (
              <div
                className="live-cruise-steering"
                aria-label="匀速前进方向修正"
              >
                {(
                  [
                    {
                      direction: "left",
                      label: "按住左修正",
                      icon: ChevronLeftIcon,
                    },
                    { direction: "center", label: "直行", icon: ChevronUpIcon },
                    {
                      direction: "right",
                      label: "按住右修正",
                      icon: ChevronRightIcon,
                    },
                  ] as const
                ).map(({ direction, label, icon: Glyph }) => (
                  <button
                    type="button"
                    key={direction}
                    aria-label={label}
                    title={label}
                    aria-pressed={control.cruiseSteering === direction}
                    disabled={
                      control.cruisePending === "start" ||
                      control.cruisePending === "stop"
                    }
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      control.steerCruise(direction);
                    }}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      control.steerCruise("center");
                    }}
                    onPointerCancel={() => control.steerCruise("center")}
                  >
                    <Glyph aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <details className="live-details live-command-details">
            <summary>
              <span>最近控制回执</span>
              <Signal
                tone={control.commandState === "failed" ? "danger" : "neutral"}
              >
                {commandLabel[control.commandState] || control.commandState}
              </Signal>
              <ChevronDownIcon aria-hidden="true" />
            </summary>
            <dl>
              <div>
                <dt>最近命令</dt>
                <dd>
                  {lastCommand
                    ? `${lastCommand.command} / ${lastCommand.speed}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>线速度 / 角速度</dt>
                <dd>
                  {lastCommand
                    ? `${lastCommand.linear_x.toFixed(3)} / ${lastCommand.angular_z.toFixed(3)}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>发布模式</dt>
                <dd>
                  {lastCommand
                    ? lastCommand.dry_run
                      ? "模拟发送"
                      : "实车发布"
                    : "—"}
                </dd>
              </div>
            </dl>
          </details>
        </section>
      </div>
      <footer className="live-page-footer">
        <span>
          <ShieldCheckIcon aria-hidden="true" />
          {status?.agent_online
            ? "设备已连接 · 操作前请确认现场安全"
            : "设备未连接 · 等待状态同步"}
        </span>
        <span>
          建图{status?.mapping_running ? "运行中" : "空闲"}
          <i />
          导航{status?.navigation_running ? "运行中" : "空闲"}
        </span>
      </footer>
    </div>
  );
}
