import { useEffect, useState, type FormEvent } from "react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  CameraIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  PhotoIcon,
  PlayCircleIcon,
  StopCircleIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";
import { VideoStream } from "./components/VideoStream";
import { API_BASE, apiFetch, clearToken, loadToken, saveToken, wsUrl } from "./lib";
import type { CaptureStatus, ConnectionState, SiyiCameraStatus, SystemStatus } from "./types";

type LoginResponse = { token: string; username: string };
type Tab = "capture" | "monitor" | "archive";

function explainMobileError(error: unknown) {
  const message = String(error ?? "").replace(/^Error:\s*/i, "").trim();
  if (message.includes("invalid credentials")) return "用户名或密码不正确。";
  if (message.includes("invalid token") || message.includes("missing bearer token")) return "登录已过期，请重新登录。";
  if (message.includes("capture is already running")) return "已有采集任务在运行。";
  if (message.includes("capture script not found")) return "采集脚本未部署到板端。";
  if (message.includes("source is not configured")) return "当前视频源未配置。";
  return message || "操作失败，请稍后重试。";
}

function formatAge(timestamp?: string | null) {
  if (!timestamp) return "等待数据";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 5) return "刚刚更新";
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.round(seconds / 60)} 分钟前`;
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" }) {
  return (
    <div className={`mobile-metric mobile-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [form, setForm] = useState({ username: "admin", password: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await apiFetch<LoginResponse>("/api/auth/login", "", {
        method: "POST",
        body: JSON.stringify(form),
      });
      saveToken(response.token);
      onLogin(response.token);
    } catch (err) {
      setError(explainMobileError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mobile-auth">
      <div className="mobile-auth-mark"><CameraIcon /></div>
      <p className="mobile-kicker">CARMOVE / FIELD CONSOLE</p>
      <h1>让每一段现场<br /><em>马上可用。</em></h1>
      <p className="mobile-auth-copy">通过 Tailscale 连接小车，实时查看视频，记录带场景和备注的训练素材。</p>
      <form className="mobile-auth-form" onSubmit={submit}>
        <label>账号<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" /></label>
        <label>密码<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="current-password" /></label>
        {error ? <div className="mobile-inline-error"><ExclamationTriangleIcon />{error}</div> : null}
        <button className="mobile-primary-button" disabled={pending}>{pending ? "正在连接…" : "进入现场控制台"}</button>
      </form>
      <p className="mobile-auth-foot"><WifiIcon /> Tailscale 私有网络 · 不暴露公网</p>
    </main>
  );
}

export default function MobileCaptureConsole() {
  const [token, setToken] = useState(loadToken());
  const [tab, setTab] = useState<Tab>("capture");
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [cameraStatus, setCameraStatus] = useState<SiyiCameraStatus | null>(null);
  const [capture, setCapture] = useState<CaptureStatus | null>(null);
  const [videoState, setVideoState] = useState<ConnectionState>("idle");
  const [useFallback, setUseFallback] = useState(false);
  const [scene, setScene] = useState("gate_a_day");
  const [note, setNote] = useState("园区入口，白天，垃圾和车辆");
  const [interval, setIntervalSeconds] = useState(1);
  const [durationMinutes, setDurationMinutes] = useState(3);
  const [pending, setPending] = useState<"start" | "stop" | "snapshot" | "refresh" | "">("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const online = !!status?.agent_online && !!status?.board_online;
  const cameraOnline = !!cameraStatus?.connected;
  const latestFrameUrl = capture?.latest_frame
    ? `${API_BASE}/api/capture/latest?token=${encodeURIComponent(token)}&v=${capture.frames_saved}`
    : "";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const socket = new WebSocket(wsUrl("/ws/status", token));
    socket.onmessage = (event) => {
      if (!cancelled) setStatus(JSON.parse(event.data) as SystemStatus);
    };
    socket.onclose = () => {
      if (!cancelled) setStatus((previous) => previous ? { ...previous, agent_online: false } : previous);
    };
    void apiFetch<SystemStatus>("/api/system/status", token).then((payload) => {
      if (!cancelled) setStatus(payload);
    }).catch((err) => {
      if (!cancelled) setError(explainMobileError(err));
    });
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = () => {
      void apiFetch<CaptureStatus>("/api/capture/status", token).then((payload) => {
        if (!cancelled) setCapture(payload);
      }).catch((err) => {
        if (!cancelled) setError(explainMobileError(err));
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = () => void apiFetch<SiyiCameraStatus>("/api/camera/status", token).then((payload) => {
      if (!cancelled) setCameraStatus(payload);
    }).catch(() => {
      if (!cancelled) setCameraStatus({ enabled: true, connected: false, error: "状态查询失败" });
    });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function refreshCapture() {
    setPending("refresh");
    try {
      const payload = await apiFetch<CaptureStatus>("/api/capture/status", token);
      setCapture(payload);
      setToast("状态已刷新");
    } catch (err) {
      setError(explainMobileError(err));
    } finally {
      setPending("");
    }
  }

  async function startCapture() {
    setPending("start");
    setError("");
    try {
      const payload = await apiFetch<CaptureStatus>("/api/capture/start", token, {
        method: "POST",
        body: JSON.stringify({
          stream_mode: "visible_raw",
          scene,
          note,
          interval_seconds: interval,
          duration_seconds: durationMinutes * 60,
          max_frames: 0,
          jpeg_quality: 95,
        }),
      });
      setCapture(payload);
      setToast("采集已开始");
    } catch (err) {
      setError(explainMobileError(err));
    } finally {
      setPending("");
    }
  }

  async function stopCapture() {
    setPending("stop");
    try {
      const payload = await apiFetch<CaptureStatus>("/api/capture/stop", token, { method: "POST" });
      setCapture(payload);
      setToast("采集已停止，manifest 已保存");
    } catch (err) {
      setError(explainMobileError(err));
    } finally {
      setPending("");
    }
  }

  async function takeSnapshot() {
    setPending("snapshot");
    try {
      await apiFetch("/api/media/snapshot", token, {
        method: "POST",
        body: JSON.stringify({ stream_mode: "visible_raw" }),
      });
      setToast("单帧已保存");
    } catch (err) {
      setError(explainMobileError(err));
    } finally {
      setPending("");
    }
  }

  function logout() {
    clearToken();
    setToken("");
  }

  if (!token) return <Login onLogin={setToken} />;

  return (
    <main className="mobile-app">
      <header className="mobile-topbar">
        <div>
          <p className="mobile-kicker">CARMOVE / FIELD CONSOLE</p>
          <h1>{tab === "capture" ? "现场采集" : tab === "monitor" ? "链路监控" : "采集记录"}</h1>
        </div>
        <button className="mobile-icon-button" aria-label="刷新状态" onClick={() => void refreshCapture()} disabled={pending === "refresh"}>
          <ArrowPathIcon className={pending === "refresh" ? "mobile-spin" : ""} />
        </button>
      </header>

      <section className="mobile-status-strip">
        <span className={`mobile-status-dot ${online ? "is-good" : "is-bad"}`} />
        <strong>{online ? "小车在线" : "等待小车"}</strong>
        <span className="mobile-status-divider" />
        <span>{cameraOnline ? "视频已连接" : "视频未连接"}</span>
        <button onClick={logout}>退出</button>
      </section>

      {error ? <button className="mobile-error-banner" onClick={() => setError("")}><ExclamationTriangleIcon />{error}<span>×</span></button> : null}
      {toast ? <div className="mobile-toast"><CheckCircleIcon />{toast}</div> : null}

      {tab === "capture" ? (
        <div className="mobile-page mobile-capture-page">
          <section className="mobile-video-card">
            <VideoStream mode="visible_raw" token={token} useFallback={useFallback} onStateChange={setVideoState} />
            <div className="mobile-video-footer">
              <span className={`mobile-video-state ${videoState === "connected" ? "is-good" : ""}`}><span />{videoState === "connected" ? "实时画面" : "正在连接"}</span>
              <button onClick={() => setUseFallback((value) => !value)}>{useFallback ? "切回低延迟" : "备用画面"}</button>
            </div>
          </section>

          <section className={`mobile-capture-card ${capture?.running ? "is-running" : ""}`}>
            <div className="mobile-section-heading">
              <div><span className="mobile-eyebrow">{capture?.running ? "CAPTURE IN PROGRESS" : "READY FOR FIELD"}</span><h2>{capture?.running ? `正在采集 ${capture.scene}` : "准备采集一段现场"}</h2></div>
              <div className={`mobile-capture-orb ${capture?.running ? "is-running" : ""}`}><CameraIcon /></div>
            </div>
            <div className="mobile-capture-counter"><strong>{capture?.frames_saved ?? 0}</strong><span>张已保存</span>{capture?.running ? <small>每 {capture.interval_seconds ?? interval}s 一张</small> : <small>保存为带 manifest 的原始帧</small>}</div>
            <div className="mobile-form-grid">
              <label className="mobile-field mobile-field-wide"><span><MapPinIcon />场景名称</span><input value={scene} onChange={(event) => setScene(event.target.value)} disabled={!!capture?.running} placeholder="例如 gate_a_day" /></label>
              <label className="mobile-field mobile-field-wide"><span><ArchiveBoxIcon />现场备注</span><input value={note} onChange={(event) => setNote(event.target.value)} disabled={!!capture?.running} placeholder="光照、路线、目标说明" /></label>
              <label className="mobile-field"><span><ClockIcon />间隔</span><select value={interval} onChange={(event) => setIntervalSeconds(Number(event.target.value))} disabled={!!capture?.running}><option value={0.5}>0.5 秒</option><option value={1}>1 秒</option><option value={2}>2 秒</option><option value={5}>5 秒</option></select></label>
              <label className="mobile-field"><span><ChartBarIcon />时长</span><select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} disabled={!!capture?.running}><option value={1}>1 分钟</option><option value={3}>3 分钟</option><option value={5}>5 分钟</option><option value={10}>10 分钟</option></select></label>
            </div>
            {capture?.running ? (
              <button className="mobile-stop-button" onClick={() => void stopCapture()} disabled={pending !== ""}><StopCircleIcon />{pending === "stop" ? "正在停止…" : "停止采集"}</button>
            ) : (
              <button className="mobile-primary-button mobile-start-button" onClick={() => void startCapture()} disabled={pending !== "" || !online || !cameraOnline}><PlayCircleIcon />{pending === "start" ? "正在启动…" : "开始采集"}</button>
            )}
            <button className="mobile-secondary-action" onClick={() => void takeSnapshot()} disabled={pending !== "" || !cameraOnline}><PhotoIcon />只保存当前这一帧</button>
          </section>
        </div>
      ) : null}

      {tab === "monitor" ? (
        <div className="mobile-page mobile-monitor-page">
          <section className="mobile-monitor-hero"><div className="mobile-monitor-signal"><WifiIcon /><span>{online ? "CONNECTED" : "OFFLINE"}</span></div><h2>{online ? "设备链路正常" : "等待设备重新上线"}</h2><p>最后心跳：{formatAge(status?.last_heartbeat)}</p></section>
          <div className="mobile-metric-grid">
            <Metric label="CPU" value={status?.cpu_percent != null ? `${status.cpu_percent.toFixed(0)}%` : "--"} />
            <Metric label="内存" value={status?.memory_percent != null ? `${status.memory_percent.toFixed(0)}%` : "--"} />
            <Metric label="GPU" value={status?.gpu_percent != null ? `${status.gpu_percent.toFixed(0)}%` : "--"} />
            <Metric label="相机" value={cameraOnline ? "在线" : "离线"} tone={cameraOnline ? "good" : "warn"} />
            <Metric label="雷达" value={status?.lidar_online ? "在线" : "停止"} tone={status?.lidar_online ? "good" : "neutral"} />
            <Metric label="IMU" value={status?.imu_online ? "在线" : "停止"} tone={status?.imu_online ? "good" : "neutral"} />
          </div>
          <section className="mobile-detail-card"><div className="mobile-detail-row"><span>视频源</span><strong>{status?.current_video_source || "--"}</strong></div><div className="mobile-detail-row"><span>分辨率目标</span><strong>video1 / 可见光</strong></div><div className="mobile-detail-row"><span>云台状态</span><strong>{cameraStatus?.status?.motion_mode_name || "--"} · {cameraStatus?.attitude?.yaw_deg?.toFixed(1) ?? "--"}° yaw</strong></div><div className="mobile-detail-row"><span>控制模式</span><strong>{status?.motion_state?.mode || "dry_run"}</strong></div></section>
          <section className="mobile-safety-note"><CheckCircleIcon /><div><strong>安全闸门保持开启</strong><p>手机端第一版只控制采集、拍照和监控，不直接启动车辆或发送运动命令。</p></div></section>
        </div>
      ) : null}

      {tab === "archive" ? (
        <div className="mobile-page mobile-archive-page">
          <section className="mobile-archive-hero"><span className="mobile-eyebrow">LATEST CAPTURE</span><h2>{capture?.scene || "还没有采集任务"}</h2><p>{capture?.manifest_path || "开始一段采集后，这里会显示 manifest 和最近一帧。"}</p></section>
          {latestFrameUrl ? <img className="mobile-latest-frame" src={latestFrameUrl} alt="最近保存的采集帧" /> : <div className="mobile-empty-state"><ArchiveBoxIcon /><strong>等待第一段现场数据</strong><span>采集完成的原始帧会保存在小车上，并按场景和日期分组。</span></div>}
          <div className="mobile-archive-stats"><Metric label="已保存" value={`${capture?.frames_saved ?? 0} 帧`} /><Metric label="采样间隔" value={`${capture?.interval_seconds ?? "--"} 秒`} /><Metric label="状态" value={capture?.running ? "进行中" : "已停止"} tone={capture?.running ? "good" : "neutral"} /></div>
          {capture?.last_error ? <div className="mobile-inline-error"><ExclamationTriangleIcon />{capture.last_error}</div> : null}
        </div>
      ) : null}

      <nav className="mobile-bottom-nav" aria-label="主导航">
        <button className={tab === "capture" ? "is-active" : ""} onClick={() => setTab("capture")}><CameraIcon /><span>采集</span></button>
        <button className={tab === "monitor" ? "is-active" : ""} onClick={() => setTab("monitor")}><ChartBarIcon /><span>监控</span></button>
        <button className={tab === "archive" ? "is-active" : ""} onClick={() => setTab("archive")}><ArchiveBoxIcon /><span>记录</span></button>
      </nav>
    </main>
  );
}
