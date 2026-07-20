import { CpuChipIcon, MapIcon, RadioIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { classNames } from "../lib";

export type SidebarTab = "live" | "navigation" | "perception" | "diagnostics";

const items = [
  { id: "live" as const, label: "实时监控", icon: RadioIcon },
  { id: "navigation" as const, label: "巡航航线", icon: MapIcon },
  { id: "perception" as const, label: "智能感知", icon: CpuChipIcon },
  { id: "diagnostics" as const, label: "系统诊断", icon: WrenchScrewdriverIcon },
];

export function SidebarMenu({ activeTab, onChange }: { activeTab: SidebarTab; onChange: (tab: SidebarTab) => void }) {
  return (
    <aside
      className="w-56 shrink-0 border-r border-sky-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,.96),rgba(241,248,255,.92))] p-4 shadow-[8px_0_28px_rgba(47,112,180,.08)] backdrop-blur"
      aria-label="工作区导航"
    >
      <p className="mb-4 text-sm font-semibold tracking-wide text-slate-800">UGV 控制菜单</p>
      <nav className="space-y-2">
        {items.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={active ? "page" : undefined}
              className={classNames(
                "relative flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40",
                active
                  ? "border-sky-400 bg-gradient-to-r from-sky-100 to-blue-50 text-sky-700 shadow-[0_8px_20px_rgba(37,99,235,.16)]"
                  : "border-transparent text-slate-500 hover:border-sky-200 hover:bg-white hover:text-sky-700 hover:shadow-sm",
              )}
            >
              <span
                className={classNames(
                  "absolute inset-y-2 left-0 w-1 rounded-r",
                  active ? "bg-gradient-to-b from-cyan-400 to-blue-600 shadow-[0_0_12px_rgba(37,99,235,.65)]" : "bg-transparent",
                )}
              />
              <span
                className={classNames(
                  "grid h-8 w-8 place-items-center rounded-md border",
                  active ? "border-sky-300 bg-white/80 text-sky-600" : "border-slate-200 bg-slate-50 text-slate-500",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
