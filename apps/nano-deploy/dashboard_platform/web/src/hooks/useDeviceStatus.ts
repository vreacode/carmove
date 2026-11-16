import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiFetch, wsUrl } from "../lib";
import type { SystemStatus } from "../types";
import { useReconnectingWebSocket } from "./useReconnectingWebSocket";

type Callbacks = {
  onStatus?: (status: SystemStatus) => void;
  onError?: (error: unknown) => void;
  onDisconnect?: () => void;
};

function isStatus(value: unknown): value is SystemStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<SystemStatus>;
  return typeof status.agent_online === "boolean" && typeof status.board_online === "boolean";
}

// The initial HTTP snapshot must never replace a newer stream update or disconnect.
export function useDeviceStatus(token: string, callbacks: Callbacks = {}) {
  const [status, updateStatus] = useState<SystemStatus | null>(null);
  const revision = useRef(0);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const setStatus: Dispatch<SetStateAction<SystemStatus | null>> = useCallback((next) => {
    revision.current++;
    updateStatus(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialRevision = ++revision.current;
    updateStatus(null);
    if (token) {
      void apiFetch<SystemStatus>("/api/system/status", token, { signal: controller.signal })
        .then((payload) => {
          if (controller.signal.aborted || revision.current !== initialRevision) return;
          if (!isStatus(payload)) throw new Error("设备状态响应无效，请稍后重试。");
          updateStatus(payload);
          callbacksRef.current.onStatus?.(payload);
        })
        .catch((error) => {
          if (!controller.signal.aborted && revision.current === initialRevision) callbacksRef.current.onError?.(error);
        });
    }
    return () => {
      controller.abort();
      revision.current++;
    };
  }, [token]);

  useReconnectingWebSocket({
    enabled: !!token,
    url: wsUrl("/ws/status", token),
    onMessage: (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isStatus(payload)) return;
      setStatus(payload);
      callbacksRef.current.onStatus?.(payload);
    },
    onDisconnect: () => {
      setStatus((current) => current ? { ...current, agent_online: false, board_online: false } : current);
      callbacksRef.current.onDisconnect?.();
    },
  });

  return [status, setStatus] as const;
}
