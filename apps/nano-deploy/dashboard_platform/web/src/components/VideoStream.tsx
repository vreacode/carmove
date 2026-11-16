import { useEffect, useRef } from "react";
import { ArrowPathIcon, ArrowsPointingOutIcon, VideoCameraIcon } from "./FlClashIcons";
import { API_BASE, classNames } from "../lib";
import type { ConnectionState } from "../types";
import { useVideoConnection } from "../hooks/useVideoConnection";

function videoModeLabel(mode: string) {
  if (mode === "visible_raw") return "可见光";
  if (mode === "ir_raw") return "红外";
  return "检测结果";
}

export function VideoStream({
  mode,
  token,
  useFallback,
  onStateChange,
  presentation,
}: {
  mode: "visible_raw" | "ir_raw" | "annotated";
  token: string;
  useFallback: boolean;
  onStateChange?: (state: ConnectionState) => void;
  presentation?: "console";
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { videoState, streamStats, effectiveFallback, revision, retry, previewLoaded, previewFailed } = useVideoConnection({ token, mode, useFallback, videoRef });
  useEffect(() => { onStateChange?.(videoState); }, [videoState, onStateChange]);
  const previewUrl = `${API_BASE}/api/stream/fallback?token=${encodeURIComponent(token)}&mode=${encodeURIComponent(mode)}&retry=${revision}`;

  if (presentation === "console") {
    const channel = mode === "ir_raw" ? "红外" : mode === "annotated" ? "检测结果" : "可见光";
    const connectionLabels: Record<ConnectionState, string> = {
      idle: "等待连接", connecting: "连接中", connected: "已连接", reconnecting: "重连中", failed: "连接失败",
    };
    const connected = videoState === "connected";
    return (
      <div className="console-feed" data-channel={mode}>
        <div className="console-feed-heading">
          <span><b>{mode === "ir_raw" ? "02" : "01"}</b>{channel}</span>
          <span className="console-feed-status" data-state={streamStats.frozen ? "failed" : videoState}><i aria-hidden="true" />{streamStats.frozen ? "画面暂停" : connectionLabels[videoState]}</span>
        </div>
        <div ref={frameRef} className="console-video-frame">
          {!effectiveFallback ? (
            <video ref={videoRef} autoPlay playsInline muted className="console-video-media" />
          ) : (
            <img
              alt={`${channel}实时画面`}
              key={`${mode}:${revision}`}
            src={previewUrl}
              className="console-video-media"
              style={{ visibility: connected ? "visible" : "hidden" }}
              onLoad={previewLoaded}
              onError={previewFailed}
            />
          )}
          {!connected && <div className="console-video-empty"><span><VideoCameraIcon aria-hidden="true" /></span><strong>{videoState === "failed" ? "视频暂不可用" : "正在连接画面"}</strong><p>{videoState === "failed" ? "请检查摄像头与视频源连接" : "等待设备传输实时视频"}</p>{(videoState === "failed" || videoState === "reconnecting") && <button type="button" className="video-retry" aria-label={`重新连接${channel}`} onClick={retry}><ArrowPathIcon aria-hidden="true" />重新连接</button>}</div>}
          <span className="console-feed-transport">{effectiveFallback ? "兼容视频" : "实时视频"}</span>
          <button type="button" className="console-video-fullscreen" aria-label={`全屏查看${channel}`} onClick={() => {
            const request = document.fullscreenElement ? document.exitFullscreen() : frameRef.current?.requestFullscreen();
            void request?.catch(() => undefined);
          }}><ArrowsPointingOutIcon aria-hidden="true" /></button>
        </div>
        <div className="console-feed-metrics">
          <span><b>{streamStats.fps != null ? streamStats.fps.toFixed(1) : "—"}</b> FPS</span>
          <span>{streamStats.width && streamStats.height ? `${streamStats.width} × ${streamStats.height}` : "分辨率 —"}</span>
          <span>延迟 <b>{streamStats.rttMs != null ? `${streamStats.rttMs.toFixed(0)} ms` : "—"}</b></span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full gap-2">
      <div ref={frameRef} className="video-frame relative overflow-hidden rounded-xl border-2 border-slate-900 bg-black shadow-inner flex-1">
        {!effectiveFallback ? (
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
        ) : (
          <img
            alt="fallback preview"
            key={`${mode}:${revision}`}
            src={previewUrl}
            className="h-full w-full object-contain"
            onLoad={previewLoaded} onError={previewFailed}
          />
        )}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded bg-black/60 px-2 py-1 text-[11px] font-mono text-white backdrop-blur">
          <div className={classNames("h-1.5 w-1.5 rounded-full", videoState !== "connected" || streamStats.frozen ? "bg-red-500" : "bg-emerald-500 animate-pulse")}></div>
          {streamStats.frozen ? "画面暂停" : `${videoModeLabel(mode)} / ${effectiveFallback ? "兼容视频" : videoState === "connected" ? "已连接" : videoState === "failed" ? "连接失败" : "连接中"}`}
        </div>
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
           {(videoState === "failed" || videoState === "reconnecting") && <button type="button" className="video-retry" onClick={retry} aria-label={`重新连接${videoModeLabel(mode)}`}>重新连接</button>}
           <button
             onClick={() => {
               if (document.fullscreenElement) {
                 void document.exitFullscreen().catch(() => undefined);
               } else {
                 void frameRef.current?.requestFullscreen()?.catch(() => undefined);
               }
             }}
             className="rounded border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white hover:bg-black/60 backdrop-blur"
           >
             全屏
           </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
        <div className="rounded border border-base bg-panel px-2 py-1.5 shadow-sm">
          <span className="text-disabled">FPS</span> <span className="float-right font-medium text-secondary">{streamStats.fps != null ? streamStats.fps.toFixed(1) : "--"}</span>
        </div>
        <div className="rounded border border-base bg-panel px-2 py-1.5 shadow-sm">
          <span className="text-disabled">RES</span> <span className="float-right font-medium text-secondary">{streamStats.width && streamStats.height ? `${streamStats.width}x${streamStats.height}` : "--"}</span>
        </div>
        <div className="rounded border border-base bg-panel px-2 py-1.5 shadow-sm">
          <span className="text-disabled">RTT</span> <span className="float-right font-medium text-secondary">{streamStats.rttMs != null ? `${streamStats.rttMs.toFixed(0)}ms` : "--"}</span>
        </div>
        <div className="rounded border border-base bg-panel px-2 py-1.5 shadow-sm">
          <span className="text-disabled">AGE</span> <span className="float-right font-medium text-secondary">{streamStats.frameAgeMs !== undefined ? `${streamStats.frameAgeMs.toFixed(0)}ms` : "--"}</span>
        </div>
        <div className="rounded border border-base bg-panel px-2 py-1.5 shadow-sm hidden 2xl:block">
          <span className="text-disabled">KBP</span> <span className="float-right font-medium text-secondary">{streamStats.bitrateKbps ? `${streamStats.bitrateKbps.toFixed(0)}` : "--"}</span>
        </div>
      </div>
    </div>
  );
}
