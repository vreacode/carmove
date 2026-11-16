import { useEffect, useId, useRef, useState } from "react";
import { XMarkIcon } from "./FlClashIcons";

export type ModelSettings = { source: string; parkingEnabled: boolean; zone: string; dwell: string };

export function ModelSettingsDialog({ initialValue, onSave, onClose }: {
  initialValue: ModelSettings;
  onSave: (settings: ModelSettings) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const zoneInput = useRef<HTMLInputElement>(null);
  const dwellInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState<{ field: "zone" | "dwell"; text: string } | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function save() {
    if (draft.parkingEnabled) {
      const parts = draft.zone.split(",").map((part) => part.trim());
      const zone = parts.map(Number);
      if (parts.length !== 4 || parts.some((part) => !part) || zone.some((n) => !Number.isFinite(n) || n < 0 || n > 1) || zone[0] >= zone[2] || zone[1] >= zone[3]) {
        setError({ field: "zone", text: "违停区域格式无效：填写 x1, y1, x2, y2（0–1），右下角坐标须大于左上角。" });
        zoneInput.current?.focus();
        return;
      }
      const seconds = Number(draft.dwell);
      if (!draft.dwell.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
        setError({ field: "dwell", text: "停留时间应为 0–3600 秒。" });
        dwellInput.current?.focus();
        return;
      }
    }
    onSave({ ...draft, source: draft.source.trim() });
  }

  return (
    <dialog ref={dialog} className="settings-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
        <header className="settings-dialog-heading">
          <div><h2 id={`${id}-title`}>检测设置</h2><p id={`${id}-description`}>保存后，在启动或切换模型时生效。</p></div>
          <button type="button" className="icon-button" aria-label="关闭设置" onClick={onClose}><XMarkIcon aria-hidden="true" /></button>
        </header>
        <div className="settings-dialog-body">
          <label className="setting-field"><span>视频输入源</span>
            <input autoFocus aria-label="视频输入源" value={draft.source} placeholder="留空使用默认摄像头" onChange={(event) => setDraft({ ...draft, source: event.target.value })} />
            <small>填写 RTSP 地址，通常保持默认即可。</small>
          </label>
          <div className="settings-group">
            <label className="setting-toggle-row">
              <span><strong>启用违停判定</strong><small>车辆在指定画面区域停留后记录事件。</small></span>
              <input type="checkbox" aria-label="启用违停判定" checked={draft.parkingEnabled} onChange={(event) => { setDraft({ ...draft, parkingEnabled: event.target.checked }); setError(null); }} />
            </label>
            {draft.parkingEnabled && <div className="settings-nested">
              <label className="setting-field"><span>禁停区域</span>
                <input ref={zoneInput} aria-label="禁停区域归一化坐标" aria-invalid={error?.field === "zone"} aria-describedby={error?.field === "zone" ? `${id}-error` : `${id}-zone-help`} value={draft.zone} onChange={(event) => { setDraft({ ...draft, zone: event.target.value }); setError(null); }} />
                <small id={`${id}-zone-help`}>左上角、右下角坐标：x1, y1, x2, y2，范围 0–1。</small>
              </label>
              <label className="setting-field"><span>停留时间（秒）</span>
                <input ref={dwellInput} type="number" min="0" max="3600" step="0.5" aria-label="违停停留秒数" aria-invalid={error?.field === "dwell"} aria-describedby={error?.field === "dwell" ? `${id}-error` : undefined} value={draft.dwell} onChange={(event) => { setDraft({ ...draft, dwell: event.target.value }); setError(null); }} />
              </label>
            </div>}
          </div>
          {error && <p className="field-error" role="alert" id={`${id}-error`}>{error.text}</p>}
        </div>
        <footer className="settings-dialog-footer"><button type="button" className="live-button" onClick={onClose}>取消</button><button type="submit" className="live-button live-button--primary">保存设置</button></footer>
      </form>
    </dialog>
  );
}
