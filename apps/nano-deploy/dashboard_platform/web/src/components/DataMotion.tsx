import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

const MotionContext = createContext({ revision: "", reducedMotion: true });

export function DataMotionProvider({
  revision,
  children,
}: PropsWithChildren<{ revision: string }>) {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const value = useMemo(
    () => ({ revision, reducedMotion }),
    [revision, reducedMotion],
  );
  return (
    <MotionContext.Provider value={value}>{children}</MotionContext.Provider>
  );
}

export const useDataMotion = () => useContext(MotionContext);

export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  className = "",
}: {
  value?: number | null;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const { revision, reducedMotion } = useDataMotion();
  const valid = typeof value === "number" && Number.isFinite(value);
  const target = valid ? value : null;
  const [display, setDisplay] = useState<number | null>(
    reducedMotion ? target : target === null ? null : 0,
  );
  const [counting, setCounting] = useState(false);
  const current = useRef(display);
  const previousRevision = useRef<string | null>(null);

  useLayoutEffect(() => {
    const entering =
      previousRevision.current !== revision || current.current === null;
    previousRevision.current = revision;
    let frame = 0;
    if (target === null || reducedMotion) {
      current.current = target;
      setDisplay(target);
      setCounting(false);
      return;
    }
    const from = entering ? 0 : (current.current ?? 0);
    const duration = entering ? 1600 : 700;
    const started = performance.now();
    current.current = from;
    setDisplay(from);
    setCounting(from !== target);
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min((now - started) / duration, 1));
      const eased = 1 - Math.pow(1 - progress, 3);
      current.current =
        progress === 1 ? target : from + (target - from) * eased;
      setDisplay(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else setCounting(false);
    };
    if (from !== target) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, revision, reducedMotion]);

  const actual = target === null ? "—" : target.toFixed(decimals);
  return (
    <span
      className={`animated-number ${className}`}
      data-target={target ?? ""}
      data-counting={counting}
      title={target === null ? "暂无数据" : `${actual}${suffix}`}
    >
      <span
        className="animated-number-value"
        style={{ minWidth: `${actual.length * 0.62}em` }}
      >
        {display === null ? "—" : display.toFixed(decimals)}
      </span>
      {target !== null && suffix && (
        <span className="animated-number-unit">{suffix}</span>
      )}
    </span>
  );
}
