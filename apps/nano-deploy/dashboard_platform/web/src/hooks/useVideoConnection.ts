import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { apiFetch } from "../lib";
import type { ConnectionState, StreamStats } from "../types";

type VideoMode = "visible_raw" | "ir_raw" | "annotated";

/** Each effect owns its peer, request, frame callback and timers. */
export function useVideoConnection({ token, mode, useFallback, videoRef }: {
  token: string;
  mode: VideoMode;
  useFallback: boolean;
  videoRef: RefObject<HTMLVideoElement>;
}) {
  const [videoState, setVideoState] = useState<ConnectionState>("idle");
  const [streamStats, setStreamStats] = useState<StreamStats>({});
  const [automaticFallback, setAutomaticFallback] = useState(false);
  const [revision, setRevision] = useState(0);
  const attempts = useRef(0);
  const clientId = useRef(typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `video-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const effectiveFallback = useFallback || automaticFallback;

  useEffect(() => { setAutomaticFallback(false); attempts.current = 0; }, [token, mode, useFallback]);

  useEffect(() => {
    setStreamStats({});
    if (!token) { setVideoState("idle"); return; }
    setVideoState("connecting");
    if (effectiveFallback) return;

    const request = new AbortController();
    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let reconnectTimer: number | undefined;
    let statsTimer: number | undefined;
    let watchTimer: number | undefined;
    let frameCallback: number | undefined;
    let video: HTMLVideoElement | null = null;
    let attachedStream: MediaStream | null = null;
    let lastFrameAt = 0;
    let decodedFrames = 0;
    let previousStats = { bytes: 0, at: 0 };
    const started = Date.now();

    function reconnect() {
      if (disposed || reconnectTimer !== undefined) return;
      setVideoState("reconnecting");
      attempts.current += 1;
      if (attempts.current >= 2) { setAutomaticFallback(true); return; }
      reconnectTimer = window.setTimeout(() => { if (!disposed) setRevision((n) => n + 1); }, 1500);
    }

    function receivedFrame(width?: number, height?: number) {
      if (disposed) return;
      lastFrameAt = Date.now();
      attempts.current = 0;
      if (reconnectTimer !== undefined) { window.clearTimeout(reconnectTimer); reconnectTimer = undefined; }
      setVideoState("connected");
      setStreamStats((old) => ({ ...old, width: width || old.width, height: height || old.height, frameAgeMs: 0, frozen: false }));
    }

    function monitorFrames(element: HTMLVideoElement) {
      if (!element.requestVideoFrameCallback) return;
      const pump = () => {
        frameCallback = element.requestVideoFrameCallback((_now, metadata) => {
          if (disposed) return;
          receivedFrame(metadata.width, metadata.height);
          pump();
        });
      };
      pump();
    }

    async function connect() {
      try {
        peer = new RTCPeerConnection();
        const current = peer;
        current.addTransceiver("video", { direction: "recvonly" });
        current.ontrack = (event) => {
          if (disposed || !videoRef.current) return;
          video = videoRef.current;
          attachedStream = event.streams[0] ?? new MediaStream([event.track]);
          video.srcObject = attachedStream;
          monitorFrames(video);
        };
        current.onconnectionstatechange = () => {
          if (disposed) return;
          if (current.connectionState === "failed" || current.connectionState === "disconnected") reconnect();
        };
        const offer = await current.createOffer();
        if (disposed) return;
        await current.setLocalDescription(offer);
        if (disposed) return;
        const answer = await apiFetch<{ sdp: string; type: RTCSdpType }>("/api/stream/webrtc-offer", token, {
          method: "POST", signal: request.signal,
          body: JSON.stringify({ sdp: offer.sdp, type: offer.type, stream_mode: mode, client_id: clientId.current }),
        });
        if (disposed) return;
        await current.setRemoteDescription(answer);
        if (disposed) return;
        let readingStats = false;
        statsTimer = window.setInterval(async () => {
          if (disposed || readingStats) return;
          readingStats = true;
          try {
            const stats = await current.getStats();
            if (disposed) return;
            stats.forEach((report) => {
              if (report.type === "inbound-rtp" && report.kind === "video") {
                const elapsed = (report.timestamp - previousStats.at) / 1000;
                const bitrate = previousStats.at && elapsed > 0 ? Math.max(0, (report.bytesReceived - previousStats.bytes) * 8 / elapsed / 1000) : 0;
                previousStats = { bytes: report.bytesReceived, at: report.timestamp };
                if (report.framesDecoded > decodedFrames && !video?.requestVideoFrameCallback) receivedFrame(report.frameWidth, report.frameHeight);
                decodedFrames = report.framesDecoded ?? decodedFrames;
                setStreamStats((old) => ({ ...old, fps: report.framesPerSecond ?? old.fps, bitrateKbps: bitrate, width: report.frameWidth ?? old.width, height: report.frameHeight ?? old.height }));
              }
              if (report.type === "candidate-pair" && report.state === "succeeded") {
                setStreamStats((old) => ({ ...old, rttMs: report.currentRoundTripTime != null ? report.currentRoundTripTime * 1000 : old.rttMs }));
              }
            });
          } catch { /* Closing a peer can invalidate an in-flight stats request. */ }
          finally { readingStats = false; }
        }, 1000);
      } catch {
        if (!disposed) reconnect();
      }
    }

    watchTimer = window.setInterval(() => {
      if (disposed) return;
      if (!lastFrameAt) { if (Date.now() - started > 8000) reconnect(); return; }
      const frameAgeMs = Date.now() - lastFrameAt;
      const frozen = frameAgeMs > 3000;
      setStreamStats((old) => ({ ...old, frameAgeMs, frozen }));
      if (frozen) setVideoState("reconnecting");
      if (frameAgeMs > 6000) reconnect();
    }, 1000);
    void connect();

    return () => {
      disposed = true;
      request.abort();
      window.clearTimeout(reconnectTimer);
      window.clearInterval(statsTimer);
      window.clearInterval(watchTimer);
      if (video && frameCallback !== undefined) video.cancelVideoFrameCallback?.(frameCallback);
      if (video && video.srcObject === attachedStream) video.srcObject = null;
      if (peer) { peer.ontrack = null; peer.onconnectionstatechange = null; peer.close(); }
    };
  }, [token, mode, effectiveFallback, revision, videoRef]);

  return { videoState, streamStats, effectiveFallback, automaticFallback, revision,
    retry: () => { attempts.current = 0; setAutomaticFallback(false); setRevision((n) => n + 1); },
    previewLoaded: () => setVideoState("connected"), previewFailed: () => setVideoState("failed"),
  };
}
