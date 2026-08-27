import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { computeOpenSlots, type AvailabilityRule, type SlotOverride } from "@/lib/availability";
import { formatCalendarDate } from "@/lib/dateFormat";
import TimeBlockPicker from "./TimeBlockPicker";

export default async function CourtPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; courtId: string }>;
  searchParams: Promise<{ date?: string; error?: string; booked?: string }>;
}) {
  const { locationId, courtId } = await params;
  const { date: dateParam, error, booked } = await searchParams;

  const supabase = await createClient();

  const { data: court } = await supabase
    .from("courts")
    .select("id, name, notes, slot_size_minutes, location:locations(id, name, timezone)")
    .eq("id", courtId)
    .eq("location_id", locationId)
    .single();

  if (!court) {
    notFound();
  }

  const location = Array.isArray(court.location) ? court.location[0] : court.location;
  const timezone = location?.timezone ?? "UTC";
  const date = dateParam ?? formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");

  const [{ data: rules }, { data: overrides }, { data: booked_slots }] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("day_of_week, open_time, close_time")
      .eq("court_id", court.id),
    supabase
      .from("slot_overrides")
      .select("date, is_closed, custom_open, custom_close")
      .eq("court_id", court.id)
      .eq("date", date),
    supabase.from("booked_slots").select("start_time, end_time").eq("court_id", court.id),
  ]);

  const slotSizeMinutes = court.slot_size_minutes ?? 60;

  const slots = computeOpenSlots({
    date,
    timezone,
    rules: (rules ?? []) as AvailabilityRule[],
    overrides: (overrides ?? []) as SlotOverride[],
    bookedRanges: booked_slots ?? [],
    durationMinutes: slotSizeMinutes,
    stepMinutes: slotSizeMinutes,
  });

  const prevDate = formatInTimeZone(
    new Date(new Date(`${date}T12:00:00Z`).getTime() - 86_400_000),
    "UTC",
    "yyyy-MM-dd"
  );
  const nextDate = formatInTimeZone(
    new Date(new Date(`${date}T12:00:00Z`).getTime() + 86_400_000),
    "UTC",
    "yyyy-MM-dd"
  );

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href={`/locations/${locationId}`} className="text-sm underline">
        &larr; {location?.name}
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">
        {court.name} — {location?.name}
      </h1>

      {court.notes && <p className="mt-2 text-sm text-gray-600">{court.notes}</p>}

      {booked && (
        <p className="mt-4 rounded bg-green-50 p-3 text-sm text-green-800">Booking confirmed.</p>
      )}
      {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <Link href={`/locations/${locationId}/courts/${courtId}?date=${prevDate}`} className="text-sm underline">
          &larr; Prev day
        </Link>
        <span className="font-medium">{formatCalendarDate(date)}</span>
        <Link href={`/locations/${locationId}/courts/${courtId}?date=${nextDate}`} className="text-sm underline">
          Next day &rarr;
        </Link>
      </div>

      <div className="mt-6">
        {slots.length === 0 ? (
          <p className="text-sm text-gray-600">No open slots this day.</p>
        ) : (
          <TimeBlockPicker
            slots={slots}
            timezone={timezone}
            courtHref={`/locations/${locationId}/courts/${courtId}`}
            date={date}
          />
        )}
      </div>
    </div>
  );
}
