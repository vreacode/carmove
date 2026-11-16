import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib";
import type { MediaItem } from "../types";

const PAGE_SIZE = 20;
type Loading = "" | "refresh" | "more";

export function useMediaGallery(token: string) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState<Loading>("");
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const page = useRef(0);
  const request = useRef<AbortController | null>(null);
  const lastRequest = useRef({ page: 1, replace: true });

  const load = useCallback(async (nextPage: number, replace: boolean) => {
    if (!token || (!replace && request.current)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    lastRequest.current = { page: nextPage, replace };
    setLoading(replace ? "refresh" : "more");
    setError("");
    try {
      const payload = await apiFetch<{ items: MediaItem[] }>(
        `/api/media/gallery?page=${nextPage}&page_size=${PAGE_SIZE}`, token, { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!Array.isArray(payload.items)) throw new Error("记录列表响应无效，请重试。");
      setItems((current) => {
        const unique = new Map<string, MediaItem>();
        for (const item of [...(replace ? [] : current), ...payload.items]) unique.set(`${item.storage_kind}/${item.filename}`, item);
        return [...unique.values()];
      });
      page.current = nextPage;
      setHasMore(payload.items.length === PAGE_SIZE);
    } catch (failure) {
      if (!controller.signal.aborted) setError(String(failure).replace(/^Error:\s*/i, ""));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading("");
      }
    }
  }, [token]);

  const refresh = useCallback(() => load(1, true), [load]);
  const loadMore = useCallback(() => hasMore ? load(page.current + 1, false) : Promise.resolve(), [hasMore, load]);
  const retry = useCallback(() => load(lastRequest.current.page, lastRequest.current.replace), [load]);

  useEffect(() => {
    page.current = 0;
    setItems([]);
    setHasMore(false);
    setError("");
    setLoading("");
    if (token) void refresh();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [token, refresh]);

  return { items, loading, error, hasMore, refresh, loadMore, retry };
}
