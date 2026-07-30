import { useEffect, useRef } from "react";

type ReconnectingWebSocketOptions = {
  enabled: boolean;
  url: string;
  onMessage: (event: MessageEvent<string>) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
};

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 5000;

export function useReconnectingWebSocket({
  enabled,
  url,
  onMessage,
  onConnect,
  onDisconnect,
}: ReconnectingWebSocketOptions) {
  const callbacksRef = useRef({ onMessage, onConnect, onDisconnect });
  callbacksRef.current = { onMessage, onConnect, onDisconnect };

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer == null) return;
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer != null) return;
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (
        stopped ||
        socket?.readyState === WebSocket.OPEN ||
        socket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }

      const current = new WebSocket(url);
      socket = current;
      current.onopen = () => {
        if (stopped || socket !== current) return;
        reconnectAttempt = 0;
        callbacksRef.current.onConnect?.();
      };
      current.onmessage = (event) => {
        if (!stopped && socket === current) {
          callbacksRef.current.onMessage(event as MessageEvent<string>);
        }
      };
      current.onerror = () => {
        if (socket === current) current.close();
      };
      current.onclose = () => {
        if (stopped || socket !== current) return;
        socket = null;
        callbacksRef.current.onDisconnect?.();
        scheduleReconnect();
      };
    };

    const reconnectWhenReachable = () => {
      if (stopped) return;
      clearReconnectTimer();
      connect();
    };
    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible") reconnectWhenReachable();
    };

    connect();
    window.addEventListener("online", reconnectWhenReachable);
    document.addEventListener("visibilitychange", reconnectWhenVisible);

    return () => {
      stopped = true;
      clearReconnectTimer();
      window.removeEventListener("online", reconnectWhenReachable);
      document.removeEventListener("visibilitychange", reconnectWhenVisible);
      socket?.close();
      socket = null;
    };
  }, [enabled, url]);
}
