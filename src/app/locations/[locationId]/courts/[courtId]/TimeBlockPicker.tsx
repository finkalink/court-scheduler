"use client";

import { useState } from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import type { Slot } from "@/lib/availability";

export default function TimeBlockPicker({
  slots,
  timezone,
  courtHref,
  date,
}: {
  slots: Slot[];
  timezone: string;
  courtHref: string;
  date: string;
}) {
  const [selection, setSelection] = useState<{ start: Slot; end: Slot } | null>(null);

  function handleClick(slot: Slot) {
    if (!selection) {
      setSelection({ start: slot, end: slot });
      return;
    }

    const onlyBlockSelected = selection.start.start === selection.end.start;
    const isStart = slot.start === selection.start.start;
    const isEnd = slot.start === selection.end.start;

    if (onlyBlockSelected && isStart) {
      setSelection(null); // clicking the only selected block deselects it
      return;
    }

    // Clicking either edge of a multi-block selection shrinks it by one
    // block from that side, rather than doing nothing (the old behavior --
    // re-clicking an edge fell into the "extend" branch below, which just
    // recomputed the same range). The selection is already known
    // contiguous, so the adjacent slot in the full list is the right one.
    if (isStart) {
      const idx = slots.findIndex((s) => s.start === slot.start);
      setSelection({ start: slots[idx + 1], end: selection.end });
      return;
    }
    if (isEnd) {
      const idx = slots.findIndex((s) => s.start === slot.start);
      setSelection({ start: selection.start, end: slots[idx - 1] });
      return;
    }

    // Clicking a block inside the selection (not an edge) can't shrink the
    // range without breaking contiguity, so start a fresh single-block
    // selection there instead.
    if (slot.start > selection.start.start && slot.start < selection.end.start) {
      setSelection({ start: slot, end: slot });
      return;
    }

    // Extend the existing selection to include this slot, in whichever
    // direction it falls -- repeated clicks keep growing the range.
    const lo = slot.start < selection.start.start ? slot : selection.start;
    const hi = slot.start > selection.end.start ? slot : selection.end;
    const between = slots.filter((s) => s.start >= lo.start && s.start <= hi.start);
    // Adjacent means every block's start lines up with the previous block's
    // end -- a booked hour removes itself from `slots`, which breaks this
    // chain, so it doubles as the "no gap" check.
    const contiguous = between.every((s, i) => i === 0 || s.start === between[i - 1].end);

    setSelection(contiguous ? { start: lo, end: hi } : { start: slot, end: slot });
  }

  const bookHref = selection
    ? `${courtHref}/book?start=${encodeURIComponent(selection.start.start)}&end=${encodeURIComponent(selection.end.end)}&date=${date}`
    : null;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((slot) => {
          const selected =
            !!selection && slot.start >= selection.start.start && slot.start <= selection.end.start;
          const label = formatInTimeZone(new Date(slot.start), timezone, "h:mm a");
          return (
            <button
              key={slot.start}
              type="button"
              onClick={() => handleClick(slot)}
              className={
                selected
                  ? "rounded border border-black bg-black px-3 py-2 text-center text-sm text-white"
                  : "rounded border border-gray-300 px-3 py-2 text-center text-sm hover:bg-gray-100 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-800"
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {bookHref ? (
          <Link href={bookHref} className="inline-block rounded bg-black px-4 py-2 text-sm text-white">
            Continue
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded bg-gray-200 px-4 py-2 text-sm text-gray-500"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}
