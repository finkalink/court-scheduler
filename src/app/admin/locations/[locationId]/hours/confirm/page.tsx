import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pushHoursToAllCourts } from "@/app/admin/actions";
import { formatTimeOfDay } from "@/lib/dateFormat";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type HoursSearchParams = Record<string, string | undefined>;

function summarizeHours(searchParams: HoursSearchParams) {
  return DAY_NAMES.map((name, day) => {
    const open = searchParams[`open_${day}`];
    const close = searchParams[`close_${day}`];
    return {
      day,
      name,
      label: open && close ? `${formatTimeOfDay(open)} – ${formatTimeOfDay(close)}` : "Closed",
    };
  });
}

export default async function LocationHoursConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>;
  searchParams: Promise<HoursSearchParams>;
}) {
  const { locationId } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const { data: courts } = await supabase
    .from("courts")
    .select("id, name")
    .eq("location_id", locationId)
    .order("name");

  const hours = summarizeHours(resolvedSearchParams);

  return (
    <div>
      <Link href={`/admin/locations/${locationId}/hours`} className="text-sm underline">
        &larr; Edit hours
      </Link>

      <h2 className="mt-4 text-lg font-medium">Confirm — {location.name}</h2>

      <ul className="mt-4 flex flex-col gap-1 text-sm">
        {hours.map((h) => (
          <li key={h.day} className="grid grid-cols-2 gap-3">
            <span className="font-medium">{h.name}</span>
            <span>{h.label}</span>
          </li>
        ))}
      </ul>

      {!courts || courts.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          This location has no courts yet, so there&apos;s nothing to apply these hours to.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-gray-600">
            This will replace the current weekly hours for these {courts.length} court
            {courts.length === 1 ? "" : "s"}:
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {courts.map((court) => (
              <li key={court.id}>{court.name}</li>
            ))}
          </ul>

          <form action={pushHoursToAllCourts} className="mt-6 flex items-center gap-4">
            <input type="hidden" name="location_id" value={locationId} />
            {DAY_NAMES.map((_, day) => (
              <span key={day}>
                <input type="hidden" name={`open_${day}`} value={resolvedSearchParams[`open_${day}`] ?? ""} />
                <input type="hidden" name={`close_${day}`} value={resolvedSearchParams[`close_${day}`] ?? ""} />
              </span>
            ))}
            <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
              Apply to All Courts
            </button>
            <Link href={`/admin/locations/${locationId}`} className="text-sm underline">
              Cancel
            </Link>
          </form>
        </>
      )}
    </div>
  );
}
