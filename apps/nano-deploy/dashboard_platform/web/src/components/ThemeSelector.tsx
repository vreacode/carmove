import { useEffect, useState } from "react";

const themes = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
] as const;

export function ThemeSelector() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("app-theme");
    return saved === "dark" || saved === "light" || saved === "system" ? saved : "system";
  });
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.setAttribute("data-theme", theme === "system" ? (query.matches ? "dark" : "light") : theme);
    apply();
    localStorage.setItem("app-theme", theme);
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  return <label className="theme-selector"><span>外观</span>
    <select aria-label="外观" value={theme} onChange={(event) => setTheme(event.target.value)}>
      {themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  </label>;
}
