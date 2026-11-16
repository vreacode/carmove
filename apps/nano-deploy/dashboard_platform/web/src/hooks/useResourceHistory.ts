import { useEffect, useRef, useState } from "react";
import type { SystemStatus } from "../types";

export type ResourceKey = "cpu" | "memory" | "gpu";
export type ResourceSample = {
  at: number;
  cpu: number | null;
  memory: number | null;
  gpu: number | null;
};

export function resourceValue(value?: number | null) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

export function useResourceHistory(status: SystemStatus | null) {
  const [samples, setSamples] = useState<ResourceSample[]>([]);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!status) {
      lastKey.current = null;
      setSamples([]);
      return;
    }
    if (!status.agent_online) return;
    const sample = {
      at: Date.now(),
      cpu: resourceValue(status.cpu_percent),
      memory: resourceValue(status.memory_percent),
      gpu: resourceValue(status.gpu_percent),
    };
    if (sample.cpu === null && sample.memory === null && sample.gpu === null)
      return;
    // One sample per heartbeat; other status/control updates must not invent history.
    const key = status.last_heartbeat || String(Math.floor(sample.at / 1000));
    if (lastKey.current === key) return;
    lastKey.current = key;
    setSamples((previous) => [...previous.slice(-59), sample]);
  }, [status]);
  return samples;
}
