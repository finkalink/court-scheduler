import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function LocationHoursPage({
  params,
}: {
  params: Promise<{ locationId: string }>;
}) {
  const { locationId } = await params;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  return (
    <div>
      <Link href={`/admin/locations/${locationId}`} className="text-sm underline">
        &larr; {location.name}
      </Link>

      <h1 className="mt-4 text-lg font-medium">General Hours — {location.name}</h1>
      <p className="mt-1 text-sm text-gray-600">
        Set the hours you want to use as this location&apos;s default, then apply them to every
        court. You&apos;ll see which courts are affected before anything is saved. Leave both
        times blank for a day the location is closed.
      </p>

      <form
        action={`/admin/locations/${locationId}/hours/confirm`}
        className="mt-6 flex flex-col gap-3"
      >
        {DAY_NAMES.map((name, day) => (
          <div key={day} className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-center sm:gap-3">
            <label className="text-sm font-medium">{name}</label>
            <input type="time" name={`open_${day}`} className="w-full rounded border px-3 py-2 text-sm" />
            <input type="time" name={`close_${day}`} className="w-full rounded border px-3 py-2 text-sm" />
          </div>
        ))}
        <button type="submit" className="mt-4 w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Review &amp; Push to All Courts
        </button>
      </form>
    </div>
  );
}
