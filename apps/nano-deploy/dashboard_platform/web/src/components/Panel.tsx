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
        "workspace-panel",
        className,
      )}
    >
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">{title}</h2>
          {subtitle ? <p className="panel-description">{subtitle}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}
