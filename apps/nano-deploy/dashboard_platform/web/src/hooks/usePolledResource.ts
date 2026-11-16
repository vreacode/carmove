import { useCallback, useEffect, useRef } from "react";
import { apiFetch } from "../lib";

type Options<T> = {
  token: string;
  path: string;
  enabled?: boolean;
  interval: number;
  onValue: (value: T) => void;
  onError: (error: unknown) => void;
};

type Request = { controller: AbortController; promise: Promise<boolean>; timeout: number };

// Only reads use this hook. Vehicle control heartbeats keep their own timing.
export function usePolledResource<T>({ token, path, enabled = true, interval, onValue, onError }: Options<T>) {
  const callbacks = useRef({ onValue, onError });
  callbacks.current = { onValue, onError };
  const currentToken = useRef(token);
  currentToken.current = token;
  const mounted = useRef(false);
  const request = useRef<Request | null>(null);

  const cancel = useCallback(() => {
    const active = request.current;
    request.current = null;
    if (active) {
      window.clearTimeout(active.timeout);
      active.controller.abort();
    }
  }, []);

  const read = useCallback((replace: boolean): Promise<boolean> => {
    if (!mounted.current || !token || !enabled || currentToken.current !== token) return Promise.resolve(false);
    if (request.current && !replace) return request.current.promise;
    cancel();
    const active: Request = { controller: new AbortController(), promise: Promise.resolve(false), timeout: 0 };
    request.current = active;
    active.promise = apiFetch<T>(path, token, { signal: active.controller.signal })
      .then((value) => {
        if (active.controller.signal.aborted) return false;
        callbacks.current.onValue(value);
        return true;
      })
      .catch((error) => {
        if (!active.controller.signal.aborted) callbacks.current.onError(error);
        return false;
      })
      .finally(() => {
        window.clearTimeout(active.timeout);
        if (request.current === active) request.current = null;
      });
    active.timeout = window.setTimeout(() => {
      if (request.current !== active || active.controller.signal.aborted) return;
      active.controller.abort();
      callbacks.current.onError(new Error("状态查询超时，请重试。"));
    }, 10000);
    return active.promise;
  }, [token, path, enabled, cancel]);

  const refresh = useCallback(() => read(true), [read]);
  const receive = useCallback((value: T) => {
    if (!mounted.current || currentToken.current !== token) return;
    cancel();
    callbacks.current.onValue(value);
  }, [token, cancel]);

  useEffect(() => {
    if (!token || !enabled) return;
    mounted.current = true;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      await read(false);
      if (!stopped) timer = window.setTimeout(poll, interval);
    };
    void poll();
    return () => {
      stopped = true;
      mounted.current = false;
      window.clearTimeout(timer);
      cancel();
    };
  }, [token, enabled, interval, read, cancel]);

  return { refresh, receive };
}
