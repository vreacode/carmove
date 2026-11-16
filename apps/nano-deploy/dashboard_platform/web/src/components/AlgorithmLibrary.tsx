import { useMemo, useRef, useState } from "react";
import { ArrowRightIcon, CameraIcon, ChevronDownIcon, MagnifyingGlassIcon, MapIcon, MapPinIcon, XMarkIcon } from "./FlClashIcons";
import { buildAlgorithmCatalog, categoryLabels, type Algorithm, type AlgorithmCategory } from "../algorithms";
import type { SystemStatus } from "../types";
import { Panel } from "./Panel";
import { AnimatedNumber } from "./DataMotion";
import { SegmentedControl } from "./SegmentedControl";

type Props = {
  status: SystemStatus | null;
  pending: boolean;
  onLoadModel: (modelId: string) => void;
  onOpenPipeline: (algorithm: Algorithm) => void;
};
const categories = ["all", "vision", "mapping", "navigation"] as const;
const icons = { vision: CameraIcon, mapping: MapIcon, navigation: MapPinIcon };

function stateLabel(algorithm: Algorithm, online: boolean) {
  if (!online) return "设备离线";
  if (algorithm.running) return "运行中";
  if (algorithm.category !== "vision") return "流程入口";
  return algorithm.configured ? "已配置" : "未配置";
}

export function AlgorithmLibrary({ status, pending, onLoadModel, onOpenPipeline }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | AlgorithmCategory>("all");
  const [selectedId, setSelectedId] = useState("model:helmet");
  const detail = useRef<HTMLDivElement>(null);
  const algorithms = useMemo(() => buildAlgorithmCatalog(status), [status]);
  const online = !!status?.agent_online;
  const filtered = algorithms.filter((algorithm) => (
    (category === "all" || algorithm.category === category) &&
    `${algorithm.name} ${algorithm.family} ${algorithm.summary} ${algorithm.modelId ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const selected = filtered.find((algorithm) => algorithm.id === selectedId) ?? filtered[0];
  const configuredCount = algorithms.filter((algorithm) => algorithm.category === "vision" && algorithm.configured).length;
  const runningCount = algorithms.filter((algorithm) => algorithm.running).length;

  return (
    <div id="section-algorithms" className="catalog-workspace">
      <div className="catalog-toolbar">
        <SegmentedControl label="算法分类" value={category} onChange={setCategory}
          options={categories.map((value) => ({ value, label: value === "all" ? "全部算法" : categoryLabels[value] }))} />
        <label className="search-field"><MagnifyingGlassIcon aria-hidden="true" />
          <input type="search" aria-label="搜索算法" placeholder="搜索算法或模型" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" className="icon-button" aria-label="清空搜索" onClick={() => setQuery("")}><XMarkIcon aria-hidden="true" /></button>}
        </label>
      </div>
      <p className="catalog-counts"><span><AnimatedNumber value={algorithms.length} /> 项算法</span><span><AnimatedNumber value={configuredCount} /> 个模型已配置</span><span><AnimatedNumber value={runningCount} /> 项运行中</span></p>
      {!online && <p role="status" className="catalog-offline">设备状态未连接。可浏览算法说明，连接后再加载模型。</p>}
      <div className="catalog-layout">
        <Panel title="算法列表" subtitle={`${filtered.length} 项匹配 · 选择查看详情`} className="catalog-list-panel">
          {filtered.length ? <div className="catalog-list">
            {filtered.map((algorithm) => {
              const Icon = icons[algorithm.category];
              return <button type="button" key={algorithm.id} aria-pressed={selected?.id === algorithm.id} className="catalog-item"
                onClick={() => {
                  setSelectedId(algorithm.id);
                  if (window.matchMedia("(max-width: 1100px)").matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ block: "start" }));
                }}>
                <Icon className="catalog-item-icon" aria-hidden="true" />
                <span className="catalog-item-copy"><strong>{algorithm.name}</strong><small>{algorithm.family}</small></span>
                <span className={algorithm.running ? "catalog-state is-running" : "catalog-state"}>{stateLabel(algorithm, online)}</span>
              </button>;
            })}
          </div> : <div className="catalog-empty"><MagnifyingGlassIcon aria-hidden="true" /><p>没有匹配的算法</p><span>换个关键词试试。</span><button type="button" className="live-button" onClick={() => { setQuery(""); setCategory("all"); }}>清除筛选</button></div>}
        </Panel>
        {selected && <div ref={detail} className="catalog-detail" key={selected.id}>
          <Panel title="算法详情">
            <p className="catalog-category">{categoryLabels[selected.category]}</p>
            <h3>{selected.name}</h3>
            <p className="catalog-description">{selected.summary}</p>
            <div className="catalog-action">
              <button type="button" className="live-button live-button--primary" disabled={selected.category === "vision" && (!online || !selected.configured || pending)}
                onClick={() => selected.modelId ? onLoadModel(selected.modelId) : onOpenPipeline(selected)}>
                {selected.category === "vision" ? (selected.running ? "查看实时结果" : "加载到实时监控") : selected.category === "mapping" ? "打开建图配置" : "打开导航页面"}<ArrowRightIcon aria-hidden="true" />
              </button>
              <p>{selected.category === "vision" ? !selected.configured ? "设备尚未配置此模型。" : selected.running ? "打开监控页面查看检测画面。" : "进入监控后启动检测，或切换当前模型。" : "在配置页面确认参数后启动。"}</p>
            </div>
            <dl className="catalog-facts">
              <div><dt>输入</dt><dd>{selected.input}</dd></div>
              <div><dt>输出</dt><dd>{selected.output}</dd></div>
              {selected.modelId && <div><dt>模型</dt><dd className="catalog-weight">{selected.modelId} · {selected.weight?.split(/[\\/]/).pop() || "未配置权重"}</dd></div>}
            </dl>
            <details className="catalog-notes"><summary>使用条件与限制<ChevronDownIcon aria-hidden="true" /></summary>
              <ul>{selected.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
              <p>{selected.boundary}</p>
              {selected.category === "vision" && <p>“已配置”表示设备提供了模型条目，启动时还会检查权重文件。</p>}
            </details>
          </Panel>
        </div>}
      </div>
    </div>
  );
}
