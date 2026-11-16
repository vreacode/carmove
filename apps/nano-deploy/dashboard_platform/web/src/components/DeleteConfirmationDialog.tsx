import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ExclamationTriangleIcon } from "./FlClashIcons";

export function DeleteConfirmationDialog({ title, name, description, onConfirm, onClose, fallbackFocus }: {
  title: string;
  name: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  fallbackFocus: RefObject<HTMLElement>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    mounted.current = true;
    element?.showModal();
    return () => {
      mounted.current = false;
      element?.close();
      requestAnimationFrame(() => {
        if (element?.isConnected && element.open) return;
        (opener?.isConnected ? opener : fallbackFocus.current)?.focus();
      });
    };
  }, [fallbackFocus]);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await onConfirm();
      if (mounted.current) onClose();
    } catch (failure) {
      if (mounted.current) setError(String(failure).replace(/^Error:\s*/i, ""));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <dialog ref={dialog} className="settings-dialog delete-confirmation" aria-labelledby={`${id}-title`} aria-describedby={`${id}-name ${id}-description`}
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      onClick={(event) => {
        if (pending || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}>
      <form onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
        <header className="settings-dialog-heading"><h2 id={`${id}-title`}>{title}</h2><ExclamationTriangleIcon aria-hidden="true" /></header>
        <div className="settings-dialog-body">
          <p className="delete-confirmation-name" id={`${id}-name`}>{name}</p>
          <p className="text-sm text-muted" id={`${id}-description`}>{description}</p>
          {error ? <p className="field-error" role="alert">{error}</p> : null}
        </div>
        <footer className="settings-dialog-footer">
          <button autoFocus type="button" className="live-button" disabled={pending} onClick={onClose}>取消</button>
          <button type="submit" className="live-button live-button--delete" disabled={pending}>{pending ? "正在删除…" : "确认删除"}</button>
        </footer>
      </form>
    </dialog>
  );
}
