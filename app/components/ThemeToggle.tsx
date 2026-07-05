"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

/**
 * Sun/moon toggle. Default is "follow the OS" (no data-theme attribute → the CSS
 * media query decides). Clicking sets an explicit override persisted to
 * localStorage, which the no-flash script in the layout re-applies before paint.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "light" || explicit === "dark") {
      setTheme(explicit);
    } else {
      setTheme(
        window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      );
    }
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — the toggle still works for this session */
    }
  }

  // Placeholder keeps layout stable until we know the effective theme.
  if (!theme) return <button className="theme-toggle" aria-label="切換主題" />;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label="切換深色或淺色主題"
      title="切換深色/淺色"
    >
      {theme === "dark" ? "☀︎" : "☾"}
    </button>
  );
}
