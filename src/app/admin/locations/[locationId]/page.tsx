import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCourt, updateCourtActive, updateCourt, updateLocation } from "@/app/admin/actions";
import SuccessBanner from "@/components/SuccessBanner";
import LocationFormFields from "@/components/LocationFormFields";
import { getRoleForOrg } from "@/lib/orgMembership";
import { isOwnerOrAdmin } from "@/lib/orgRoles";

export default async function AdminLocationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>;
  searchParams: Promise<{
    court_added?: string;
    court_saved?: string;
    active_changed?: string;
    location_saved?: string;
    hours_pushed?: string;
  }>;
}) {
  const { locationId } = await params;
  const { court_added, court_saved, active_changed, location_saved, hours_pushed } = await searchParams;
  const supabase = await createClient();

  const { data: location } = await supabase
    .from("locations")
    .select("id, name, address, timezone, postal_code, city, latitude, longitude, formatted_address, org_id")
    .eq("id", locationId)
    .single();

  if (!location) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = await getRoleForOrg(supabase, user?.id, location.org_id);
  const canManage = role ? isOwnerOrAdmin(role) : false;

  const { data: courts } = await supabase
    .from("courts")
    .select("id, name, surface_type, is_active, notes, slot_size_minutes")
    .eq("location_id", locationId)
    .order("name");

  return (
    <div>
      <Link href="/admin" className="text-sm underline">
        &larr; Locations
      </Link>

      <h2 className="mt-4 text-lg font-medium">{location.name} — Courts</h2>

      <Link href={`/admin/locations/${locationId}/hours`} className="mt-2 block w-fit text-sm underline">
        General Hours &rarr;
      </Link>

      {hours_pushed && <SuccessBanner>Hours applied to all courts.</SuccessBanner>}

      {canManage && (location.latitude == null || location.longitude == null) && (
        <p className="mt-2 rounded bg-yellow-50 p-3 text-sm text-yellow-800">
          This location&apos;s address hasn&apos;t been verified, so players won&apos;t see
          weather forecasts. Verify it below.
        </p>
      )}

      {canManage && (
        <details className="mt-4" open={Boolean(location_saved)}>
          <summary className="w-fit cursor-pointer text-sm underline">Edit location</summary>
          <form action={updateLocation} className="mt-2 flex max-w-sm flex-col gap-3">
            <input type="hidden" name="location_id" value={locationId} />
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input
                name="name"
                defaultValue={location.name}
                required
                className="rounded border px-3 py-2"
              />
            </label>
            <LocationFormFields
              defaultAddress={location.address ?? ""}
              defaultPostalCode={location.postal_code ?? null}
              defaultCity={location.city ?? null}
              defaultLatitude={location.latitude ?? null}
              defaultLongitude={location.longitude ?? null}
              defaultFormattedAddress={location.formatted_address ?? null}
              defaultTimezone={location.timezone}
            />
            <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
              Save
            </button>
            {location_saved && <p className="text-xs text-green-800">Location saved.</p>}
          </form>
        </details>
      )}

      {court_added && <SuccessBanner>Court added.</SuccessBanner>}

      {(!courts || courts.length === 0) && (
        <p className="mt-1 text-sm text-gray-600">No courts yet. Add one below.</p>
      )}

      <ul className="mt-4 flex flex-col gap-3">
        {(courts ?? []).map((court) => (
          <li
            key={court.id}
            className="rounded border border-gray-300 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <Link href={`/admin/locations/${locationId}/courts/${court.id}`} className="font-medium underline">
                  {court.name}
                </Link>
                <p className="text-sm text-gray-600">
                  {court.surface_type}
                  {court.surface_type ? " · " : ""}
                  {court.is_active ? "Active" : "Inactive"}
                  {" · "}
                  {court.slot_size_minutes === 30 ? "Half-hour blocks" : "Full-hour blocks"}
                </p>
              </div>
              {canManage && (
                <form action={updateCourtActive}>
                  <input type="hidden" name="court_id" value={court.id} />
                  <input type="hidden" name="location_id" value={locationId} />
                  <input type="hidden" name="is_active" value={String(court.is_active)} />
                  <button type="submit" className="text-sm underline">
                    {court.is_active ? "Deactivate" : "Activate"}
                  </button>
                </form>
              )}
            </div>

            {active_changed === court.id && (
              <p className="mt-2 text-xs text-green-800">
                {court.is_active ? "Court activated." : "Court deactivated."}
              </p>
            )}

            {canManage && (
              <details className="mt-3" open={court_saved === court.id}>
                <summary className="w-fit cursor-pointer text-xs underline">Edit court</summary>
                <form action={updateCourt} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="court_id" value={court.id} />
                  <input type="hidden" name="location_id" value={locationId} />
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    Name
                    <input
                      name="name"
                      defaultValue={court.name}
                      required
                      className="rounded border px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    Surface type
                    <input
                      name="surface_type"
                      defaultValue={court.surface_type ?? ""}
                      className="rounded border px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    Booking block size
                    <select
                      name="slot_size_minutes"
                      defaultValue={String(court.slot_size_minutes ?? 60)}
                      className="rounded border px-3 py-2 text-sm"
                    >
                      <option value="60">Full hour</option>
                      <option value="30">Half hour</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-gray-600">
                    Court notes (shown to players)
                    <textarea
                      name="notes"
                      defaultValue={court.notes ?? ""}
                      rows={2}
                      className="rounded border px-3 py-2 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    className="w-fit rounded bg-black px-3 py-1.5 text-xs text-white"
                  >
                    Save
                  </button>
                  {court_saved === court.id && <p className="text-xs text-green-800">Saved.</p>}
                </form>
              </details>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <>
          <h3 className="mt-8 text-sm font-medium">Add a court</h3>
          <form action={createCourt} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="location_id" value={locationId} />
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input name="name" required className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Surface type
              <input name="surface_type" className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Court notes (optional, shown to players)
              <textarea name="notes" rows={2} className="rounded border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Booking block size
              <select name="slot_size_minutes" defaultValue="60" className="rounded border px-3 py-2">
                <option value="60">Full hour</option>
                <option value="30">Half hour</option>
              </select>
            </label>
            <button type="submit" className="mt-1 w-fit rounded bg-black px-4 py-2 text-sm text-white">
              Add court
            </button>
          </form>
        </>
      )}
    </div>
  );
}
