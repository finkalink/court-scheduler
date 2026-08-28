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
        className="flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <span>{selected ? formatTimezoneLabel(selected) : value}</span>
        <span className="text-gray-400 dark:text-neutral-500">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded border bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="border-b p-2 dark:border-neutral-700">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search timezones…"
              className="w-full rounded border px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1 text-sm">
            {results.length === 0 && (
              <li className="px-3 py-2 text-gray-500 dark:text-neutral-400">No matches.</li>
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
                      ? "bg-gray-100 dark:bg-neutral-800"
                      : ""
                  } ${
                    option.id === value
                      ? "font-medium text-blue-700 dark:text-blue-400"
                      : "dark:text-neutral-100"
                  }`}
                >
                  {formatTimezoneLabel(option)}
                </button>
                {!query && option.id === value && (
                  <div className="my-1 border-t dark:border-neutral-700" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
