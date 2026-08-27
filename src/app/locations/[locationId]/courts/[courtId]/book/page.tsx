import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { createClient } from "@/lib/supabase/server";
import { createBooking } from "@/app/actions/bookings";
import { NET_HEIGHT_OPTIONS, COURT_LINES_OPTIONS } from "@/lib/courtConfig";
import { formatBookingDate } from "@/lib/dateFormat";

export default async function BookCourtPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string; courtId: string }>;
  searchParams: Promise<{ start?: string; end?: string; date?: string }>;
}) {
  const { locationId, courtId } = await params;
  const { start, end, date } = await searchParams;

  if (!start || !end || !date) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: court } = await supabase
    .from("courts")
    .select("id, name, location:locations(id, name, timezone)")
    .eq("id", courtId)
    .eq("location_id", locationId)
    .single();

  if (!court) {
    notFound();
  }

  const location = Array.isArray(court.location) ? court.location[0] : court.location;
  const timezone = location?.timezone ?? "UTC";
  const dateLabel = formatBookingDate(start, timezone);
  const timeLabel = `${formatInTimeZone(new Date(start), timezone, "h:mm a")} – ${formatInTimeZone(new Date(end), timezone, "h:mm a")}`;

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <Link href={`/locations/${locationId}/courts/${courtId}?date=${date}`} className="text-sm underline">
        &larr; Pick a different time
      </Link>

      <h1 className="mt-4 text-xl font-semibold sm:text-2xl">Confirm booking</h1>
      <p className="mt-1 text-sm text-gray-600">
        {court.name} — {location?.name}
      </p>
      <p className="mt-1 font-medium">
        {dateLabel} · {timeLabel}
      </p>

      {!user && (
        <p className="mt-4 rounded bg-blue-50 p-3 text-sm text-blue-800">
          You&apos;ll be asked to sign in when you confirm.
        </p>
      )}

      <form action={createBooking} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="court_id" value={court.id} />
        <input type="hidden" name="location_id" value={locationId} />
        <input type="hidden" name="start_time" value={start} />
        <input type="hidden" name="end_time" value={end} />
        <input type="hidden" name="date" value={date} />

        <label className="flex flex-col gap-1 text-sm">
          Net height
          <select name="requested_net_height" className="rounded border px-3 py-2">
            {NET_HEIGHT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Court lines
          <select name="requested_court_lines" className="rounded border px-3 py-2">
            {COURT_LINES_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="mt-2 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Confirm booking
        </button>
      </form>
    </div>
  );
}
