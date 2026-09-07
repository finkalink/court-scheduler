// src/components/ThemeToggle.tsx
"use client";

import { useEffect, useState } from "react";
import { THEME_COOKIE_NAME, type Theme } from "@/lib/theme";

export default function ThemeToggle({ initialTheme }: { initialTheme: Theme | null }) {
  const [theme, setTheme] = useState<Theme>(initialTheme ?? "light");

  useEffect(() => {
    if (initialTheme) return; // server already resolved an explicit choice -- trust it
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate one-shot post-hydration correction to match OS preference when no cookie exists yet; not a subscription/loop
    setTheme(prefersDark ? "dark" : "light");
  }, [initialTheme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE_NAME}=${next}; max-age=31536000; path=/; samesite=lax`;
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Toggle dark mode"
      onClick={toggle}
      className="flex items-center gap-2 border-0 bg-transparent p-0 text-xs text-fg-muted appearance-none"
    >
      <span
        className={`relative h-4 w-7 rounded-full transition-colors ${
          theme === "dark" ? "bg-accent" : "bg-fg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
            theme === "dark" ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      {theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}
