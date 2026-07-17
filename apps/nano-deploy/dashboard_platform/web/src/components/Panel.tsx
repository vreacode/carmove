import type { PropsWithChildren, ReactNode } from "react";
import { classNames } from "../lib";

type PanelProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  className?: string;
  right?: ReactNode;
}>;

export function Panel({ title, subtitle, className, right, children }: PanelProps) {
  return (
    <section
      className={classNames(
        "rounded-2xl border border-base bg-panel p-5 shadow-sm",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-divider pb-3">
        <div>
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
