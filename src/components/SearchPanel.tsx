"use client";

import { useEffect, useRef } from "react";

export default function SearchPanel({
  isPlatformAdmin,
  onClose,
}: {
  isPlatformAdmin: boolean;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("click", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Search"
      className="absolute right-4 top-full z-50 mt-2 w-72 rounded border border-border bg-card p-4 sm:right-6"
    >
      <form action="/cities" className="flex gap-2">
        <input
          name="q"
          placeholder="Search cities"
          aria-label="Search cities"
          autoFocus
          className="w-full rounded border border-border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-accent-fg">
          Go
        </button>
      </form>

      {isPlatformAdmin && (
        <div className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <a href="/site-admin/orgs" className="text-sm text-link underline" onClick={onClose}>
            Site admin: Organizations
          </a>
          <a href="/site-admin/users" className="text-sm text-link underline" onClick={onClose}>
            Site admin: Users
          </a>
          <a href="/site-admin/settings" className="text-sm text-link underline" onClick={onClose}>
            Site admin: Settings
          </a>
        </div>
      )}
    </div>
  );
}
