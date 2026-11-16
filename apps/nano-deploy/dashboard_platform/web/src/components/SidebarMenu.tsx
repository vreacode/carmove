import { ChevronRightIcon, BookOpenIcon, CpuChipIcon, MapIcon, DashboardIcon, WrenchScrewdriverIcon } from "./FlClashIcons";
import { classNames } from "../lib";
import type { SystemStatus } from "../types";

export type SidebarTab = "live" | "navigation" | "perception" | "algorithms" | "diagnostics";

const items = [
  { id: "live" as const, label: "实时监控", hint: "视频与操控", icon: DashboardIcon },
  { id: "navigation" as const, label: "建图导航", hint: "地图与导航", icon: MapIcon },
  { id: "perception" as const, label: "录像与记录", hint: "媒体与模型", icon: CpuChipIcon },
  { id: "algorithms" as const, label: "算法库", hint: "能力与运行入口", icon: BookOpenIcon },
  { id: "diagnostics" as const, label: "系统诊断", hint: "资源与底盘", icon: WrenchScrewdriverIcon },
];

export function SidebarMenu({ activeTab, onChange, status }: { activeTab: SidebarTab; onChange: (tab: SidebarTab) => void; status?: SystemStatus | null }) {
  return (
    <aside className="workspace-sidebar" aria-label="工作区导航">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true"><CpuChipIcon /></span>
        <div><p className="brand-name">CarMove</p><p className="brand-caption">无人车控制台</p></div>
      </div>
      <p className="sidebar-section-label">功能</p>
      <nav className="sidebar-navigation" aria-label="功能页面">
        {items.map(({ id, label, hint, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={active ? "page" : undefined}
              className={classNames("sidebar-link", active && "is-active")}
            >
              <Icon className="sidebar-link-icon" aria-hidden="true" />
              <span className="sidebar-link-copy"><span>{label}</span><small>{hint}</small></span>
              <ChevronRightIcon className="sidebar-link-chevron" aria-hidden="true" />
            </button>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <span className={classNames("sidebar-device-dot", status?.agent_online && "is-online")} />
        <div><p>Jetson · NANO</p><span>{status?.agent_online ? "设备已连接" : "等待设备连接"}</span></div>
      </div>
    </aside>
  );
}
