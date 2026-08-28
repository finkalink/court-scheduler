import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import {
  computeOpenSlots,
  resolveDayHours,
  type AvailabilityRule,
  type SlotOverride,
} from "@/lib/availability";
import { formatCalendarDate, formatTimeOfDay } from "@/lib/dateFormat";
import { buildMapsUrl } from "@/lib/maps";
import { fetchHourlyForecast, filterHoursToWindow, describeWeatherCode } from "@/lib/weather";
import TimeBlockPicker from "./TimeBlockPicker";

export default async function CourtPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; courtId: string }>;
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const { locationId, courtId } = await params;
  const { date: dateParam, error } = await searchParams;

  const supabase = await createClient();
  const userAgent = (await headers()).get("user-agent");

  const { data: court } = await supabase
    .from("courts")
    .select(
      "id, name, notes, slot_size_minutes, location:locations(id, name, timezone, address, latitude, longitude)"
    )
    .eq("id", courtId)
    .eq("location_id", locationId)
    .single();

  if (!court) {
    notFound();
  }

  const location = Array.isArray(court.location) ? court.location[0] : court.location;
  const timezone = location?.timezone ?? "UTC";
  const mapsUrl = buildMapsUrl({
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    address: location?.address ?? null,
    userAgent,
  });
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

  const dayHours = resolveDayHours(date, (rules ?? []) as AvailabilityRule[], (overrides ?? []) as SlotOverride[]);
  let hourlyForecast: ReturnType<typeof filterHoursToWindow> = [];
  if (dayHours && location?.latitude != null && location?.longitude != null) {
    const forecast = await fetchHourlyForecast({
      latitude: location.latitude,
      longitude: location.longitude,
      date,
      timezone,
    });
    if (forecast) {
      hourlyForecast = filterHoursToWindow(forecast, dayHours.openTime, dayHours.closeTime);
    }
  }

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

      {location?.address && (
        <a
          href={mapsUrl ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-gray-600 underline decoration-dotted"
        >
          {location.address}
        </a>
      )}

      {court.notes && <p className="mt-2 text-sm text-gray-600">{court.notes}</p>}

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

      {hourlyForecast.length > 0 && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
          {hourlyForecast.map((hour) => {
            const { emoji, label } = describeWeatherCode(hour.weatherCode);
            return (
              <div
                key={hour.time}
                className="flex shrink-0 flex-col items-center rounded border border-gray-300 px-3 py-2 text-center text-xs"
              >
                <span className="font-medium">{formatTimeOfDay(hour.time.slice(11, 16))}</span>
                <span className="mt-1 text-lg" title={label}>
                  {emoji}
                </span>
                <span>{Math.round(hour.temperature)}°F</span>
                <span className="text-gray-600">{Math.round(hour.precipitationProbability)}%</span>
              </div>
            );
          })}
        </div>
      )}

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
