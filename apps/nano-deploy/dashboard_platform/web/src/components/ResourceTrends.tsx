import { useLayoutEffect, useRef, useState } from "react";
import { CpuChipIcon, CircleStackIcon } from "./FlClashIcons";
import { AnimatedNumber, useDataMotion } from "./DataMotion";
import {
  resourceValue,
  type ResourceKey,
  type ResourceSample,
} from "../hooks/useResourceHistory";
import type { SystemStatus } from "../types";

const series = [
  { key: "cpu", label: "CPU", detail: "处理器占用", color: "rgb(var(--fl-primary))" },
  { key: "memory", label: "内存", detail: "内存使用率", color: "rgb(var(--fl-primary))" },
  { key: "gpu", label: "GPU", detail: "图形处理器占用", color: "rgb(var(--fl-primary))" },
] as const;

type Point = { at: number; value: number; x: number };

// Adapted from prism_ui 63450c0/lib/line_chart.dart (GPL-3.0-only).
// Gaussian sigma 1.5, radius 4; clamped Catmull-Rom tangents. No synthetic history.
function smoothPath(points: Point[]) {
  if (points.length < 2) return "";
  const values = points.map((_, i) => {
    let total = 0, weights = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(points.length - 1, i + 4); j++) {
      const weight = Math.exp(-((j - i) ** 2) / (2 * 1.5 ** 2));
      total += points[j].value * weight;
      weights += weight;
    }
    return total / weights;
  });
  const slopes = values.map((v, i) => i === 0 || i === values.length - 1 ? 0
    : Math.max(-3 * v, Math.min(3 * v, (values[i + 1] - values[i - 1]) / 2)));
  const y = (value: number) => 80 - (value / 100) * 78;
  let path = `M ${points[0].x} ${y(values[0])}`;
  for (let i = 1; i < points.length; i++) {
    const step = points[i].x - points[i - 1].x;
    path += ` C ${points[i - 1].x + step / 3} ${y(values[i - 1] + slopes[i - 1] / 3)}, ${points[i].x - step / 3} ${y(values[i] - slopes[i] / 3)}, ${points[i].x} ${y(values[i])}`;
  }
  return path;
}

export function ResourceCurve({
  samples,
  metric,
  color,
  compact = false,
}: {
  samples: ResourceSample[];
  metric: ResourceKey;
  color: string;
  compact?: boolean;
}) {
  const { revision, reducedMotion } = useDataMotion();
  const shown = useRef<Point[]>([]);
  const previousRevision = useRef<string | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [animating, setAnimating] = useState(false);

  useLayoutEffect(() => {
    const received = samples.filter((sample) => sample[metric] !== null);
    const target = received.map((sample, index) => ({
      at: sample.at,
      value: sample[metric]!,
      x: received.length < 2 ? 298 : (index / (received.length - 1)) * 300,
    }));
    const entering =
      previousRevision.current !== revision || shown.current.length < 2;
    previousRevision.current = revision;
    if (reducedMotion || target.length < 2) {
      shown.current = target;
      setPoints(target);
      setAnimating(false);
      return;
    }
    const previous = new Map(shown.current.map((point) => [point.at, point]));
    const lastPoint = shown.current[shown.current.length - 1] ?? {
      x: 295,
      value: 0,
    };
    const from = target.map((point) =>
      entering
        ? { x: point.x, value: 0 }
        : (previous.get(point.at) ?? lastPoint),
    );
    const started = performance.now(),
      duration = entering ? 1600 : 700;
    let frame = 0;
    setAnimating(true);
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min((now - started) / duration, 1));
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = target.map((point, index) => ({
        at: point.at,
        value: from[index].value + (point.value - from[index].value) * eased,
        x: from[index].x + (point.x - from[index].x) * eased,
      }));
      shown.current = next;
      setPoints(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setAnimating(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [samples, metric, revision, reducedMotion]);

  const path = smoothPath(points);
  const label =
    points.length === 0
      ? "等待设备采样"
      : points.length === 1
        ? "正在积累趋势"
        : `${series.find((item) => item.key === metric)?.label} 最近 ${points.length} 次采样趋势`;
  return (
    <div
      className={`resource-curve ${compact ? "resource-curve--compact" : ""}`}
      data-samples={points.length}
      data-animating={animating}
    >
      <svg
        viewBox="0 0 300 84"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {path && (
          <>
            <path
              d={`${path} L ${points[points.length - 1].x} 80 L ${points[0].x} 80 Z`}
              fill={color}
              fillOpacity="0.14"
            />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          </>
        )}
        {points.length === 1 && (
          <circle
            cx={points[0].x}
            cy={80 - (points[0].value / 100) * 78}
            r="2.5"
            fill={color}
          />
        )}
      </svg>
      {!compact && points.length < 2 && (
        <span className="resource-empty">{label}</span>
      )}
    </div>
  );
}

export function ResourceSummary({
  metric,
  status,
  samples,
}: {
  metric: "cpu" | "memory";
  status: SystemStatus | null;
  samples: ResourceSample[];
}) {
  const config = series.find((item) => item.key === metric)!;
  const value = status?.agent_online
    ? resourceValue(
        metric === "cpu" ? status.cpu_percent : status.memory_percent,
      )
    : null;
  const Icon = metric === "cpu" ? CpuChipIcon : CircleStackIcon;
  return (
    <div
      className="live-summary-card live-resource-summary"
      aria-label={`${config.label}负载`}
    >
      <div className="live-summary-label">
        <Icon aria-hidden="true" />
        <span>{config.label === "CPU" ? "处理器 CPU" : "运行内存"}</span>
      </div>
      <div className="live-resource-value">
        <strong>
          <AnimatedNumber value={value} decimals={1} suffix="%" />
        </strong>
        <ResourceCurve
          samples={samples}
          metric={metric}
          color={config.color}
          compact
        />
      </div>
      <span className="live-summary-detail">
        {value === null ? "等待设备遥测" : config.detail}
      </span>
    </div>
  );
}

export function ResourceTrends({
  status,
  samples,
}: {
  status: SystemStatus | null;
  samples: ResourceSample[];
}) {
  const values = {
    cpu: status?.cpu_percent,
    memory: status?.memory_percent,
    gpu: status?.gpu_percent,
  };
  return (
    <section
      className="resource-overview"
      aria-labelledby="resource-overview-title"
    >
      <header>
        <div>
          <h2 id="resource-overview-title">设备运行趋势</h2>
          <p>CPU、内存与 GPU</p>
        </div>
        <span>
          {status?.agent_online ? "本次连接" : "设备离线"}
          <i />
          {samples.length} 次采样
        </span>
      </header>
      <div className="resource-metrics">
        {series.map((item) => (
          <div
            className="resource-metric"
            key={item.key}
            aria-label={`${item.label}资源趋势`}
          >
            <span className="resource-metric-label">
              <i style={{ background: item.color }} />
              {item.label}
            </span>
            <strong>
              <AnimatedNumber
                value={
                  status?.agent_online ? resourceValue(values[item.key]) : null
                }
                decimals={1}
                suffix="%"
              />
            </strong>
            <ResourceCurve
              samples={samples}
              metric={item.key}
              color={item.color}
            />
          </div>
        ))}
      </div>
      <footer>
        <span>最近 60 次采样 · 曲线平滑显示</span>
        <span>
          最新心跳{" "}
          {status?.last_heartbeat
            ? new Date(status.last_heartbeat).toLocaleTimeString()
            : "—"}
        </span>
      </footer>
    </section>
  );
}
