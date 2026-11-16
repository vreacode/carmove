import { useRef } from "react";

type Option<T extends string> = { value: T; label: string; disabled?: boolean };

export function SegmentedControl<T extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="choice-control" role="group" aria-label={label}>
      {options.map((option, index) => (
        <button key={option.value} ref={(element) => { buttons.current[index] = element; }} type="button"
          aria-pressed={value === option.value} disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (disabled || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const enabled = options.map((item, i) => item.disabled ? -1 : i).filter((i) => i !== -1);
            if (!enabled.length) return;
            const position = enabled.indexOf(index);
            const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1]
              : enabled[(position + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length];
            onChange(options[next].value);
            buttons.current[next]?.focus();
          }}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
