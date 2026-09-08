"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TIMEZONE_OPTIONS, formatTimezoneLabel, type TimezoneOption } from "@/lib/timezones";

export default function TimezoneSelect({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => TIMEZONE_OPTIONS.find((option) => option.id === value) ?? null,
    [value]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Pin the current selection to the top so it's visible without scrolling or searching.
      const rest = TIMEZONE_OPTIONS.filter((option) => option.id !== value);
      return selected ? [selected, ...rest] : rest;
    }
    return TIMEZONE_OPTIONS.filter((option) => option.search.includes(q));
  }, [query, value, selected]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
        setHighlighted(0);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function pick(option: TimezoneOption) {
    onChange(option.id);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlighted]) pick(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setHighlighted(0);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setHighlighted(0);
        }}
        className="flex w-full items-center justify-between rounded border border-border bg-card px-3 py-2 text-left text-sm text-fg"
      >
        <span>{selected ? formatTimezoneLabel(selected) : value}</span>
        <span className="text-fg-muted">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded border border-border bg-card shadow-lg">
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search timezones…"
              className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-fg"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1 text-sm">
            {results.length === 0 && (
              <li className="px-3 py-2 text-fg-muted">No matches.</li>
            )}
            {results.map((option, i) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  onClick={() => pick(option)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`w-full px-3 py-1.5 text-left ${
                    i === highlighted
                      ? "bg-active"
                      : ""
                  } ${
                    option.id === value
                      ? "font-medium text-accent"
                      : "text-fg"
                  }`}
                >
                  {formatTimezoneLabel(option)}
                </button>
                {!query && option.id === value && (
                  <div className="my-1 border-t border-border" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
