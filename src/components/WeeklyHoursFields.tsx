import { MAX_RANGES_PER_DAY } from "@/lib/availability";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface HourRange {
  open_time?: string | null;
  close_time?: string | null;
}

// Renders MAX_RANGES_PER_DAY open/close pairs under one field-name prefix,
// e.g. prefix "d0" -> "d0_open_0"/"d0_close_0", "d0_open_1"/"d0_close_1", ...
// A blank pair is simply omitted when the form is parsed server-side.
export function HourRangeFields({ prefix, ranges }: { prefix: string; ranges: HourRange[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: MAX_RANGES_PER_DAY }).map((_, idx) => {
        const range = ranges[idx];
        return (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="time"
              name={`${prefix}_open_${idx}`}
              defaultValue={range?.open_time?.slice(0, 5) ?? ""}
              className="w-full rounded border px-3 py-2 text-sm"
            />
            <span className="text-xs text-gray-500">to</span>
            <input
              type="time"
              name={`${prefix}_close_${idx}`}
              defaultValue={range?.close_time?.slice(0, 5) ?? ""}
              className="w-full rounded border px-3 py-2 text-sm"
            />
          </div>
        );
      })}
    </div>
  );
}

// One HourRangeFields block per day of the week, prefixed "d0".."d6".
export default function WeeklyHoursFields({ rangesByDay }: { rangesByDay: Map<number, HourRange[]> }) {
  return (
    <div className="flex flex-col gap-4">
      {DAY_NAMES.map((name, day) => (
        <div key={day} className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-start sm:gap-3">
          <label className="pt-2 text-sm font-medium">{name}</label>
          <div className="sm:col-span-2">
            <HourRangeFields prefix={`d${day}`} ranges={rangesByDay.get(day) ?? []} />
          </div>
        </div>
      ))}
    </div>
  );
}
