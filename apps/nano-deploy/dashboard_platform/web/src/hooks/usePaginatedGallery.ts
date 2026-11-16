import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib";

const PAGE_SIZE = 20;
type Loading = "" | "refresh" | "more" | "background";

export function usePaginatedGallery<T>({ token, path, keyOf, enabled = true }: {
  token: string; path: string; keyOf: (item: T) => string; enabled?: boolean;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState<Loading>("");
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const page = useRef(0);
  const [currentPage, setCurrentPage] = useState(0);
  const key = useRef(keyOf);
  key.current = keyOf;
  const context = useRef({ token, path, enabled });
  context.current = { token, path, enabled };
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const lastRequest = useRef({ page: 1, replace: true, background: false });

  const load = useCallback(async (nextPage: number, replace: boolean, background = false) => {
    if (!mounted.current || !token || !enabled || context.current.token !== token || context.current.path !== path || !context.current.enabled) return;
    if (!replace && request.current && !lastRequest.current.background) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    lastRequest.current = { page: nextPage, replace, background };
    setLoading(background ? "background" : replace ? "refresh" : "more");
    setError("");
    try {
      const payload = await apiFetch<{ items: T[] }>(
        `${path}?page=${nextPage}&page_size=${PAGE_SIZE}`, token, { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!Array.isArray(payload.items)) throw new Error("记录列表响应无效，请重试。");
      setItems((current) => {
        const unique = new Map<string, T>();
        for (const item of [...(replace ? [] : current), ...payload.items]) unique.set(key.current(item), item);
        return [...unique.values()];
      });
      page.current = nextPage;
      setCurrentPage(nextPage);
      setHasMore(payload.items.length === PAGE_SIZE);
    } catch (failure) {
      if (!controller.signal.aborted) setError(String(failure).replace(/^Error:\s*/i, ""));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading("");
      }
    }
  }, [token, path, enabled]);

  const refresh = useCallback(() => load(1, true), [load]);
  const loadMore = useCallback(() => hasMore ? load(page.current + 1, false) : Promise.resolve(), [hasMore, load]);
  const refreshIfIdle = useCallback(() => request.current ? Promise.resolve() : load(1, true, true), [load]);
  const retry = useCallback(() => load(lastRequest.current.page, lastRequest.current.replace), [load]);

  const remove = useCallback((removedKey: string) => {
    if (!mounted.current || context.current.token !== token || context.current.path !== path) return;
    request.current?.abort();
    request.current = null;
    setLoading("");
    setItems((current) => current.filter((item) => key.current(item) !== removedKey));
  }, [token, path]);

  useEffect(() => {
    page.current = 0;
    setCurrentPage(0);
    setItems([]);
    setHasMore(false);
    setError("");
    setLoading("");
  }, [token, path]);

  useEffect(() => {
    mounted.current = true;
    if (token && enabled) void refresh();
    else setLoading("");
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, [token, enabled, refresh]);

  return { items, page: currentPage, loading, error, hasMore, refresh, refreshIfIdle, loadMore, retry, remove };
}
