"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MAX_RANGES_PER_DAY } from "@/lib/availability";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

// Reads up to MAX_RANGES_PER_DAY "{prefix}_open_{idx}"/"{prefix}_close_{idx}"
// pairs off a submitted form; a pair with either field blank is skipped.
function parseRanges(formData: FormData, prefix: string) {
  const ranges: { open_time: string; close_time: string }[] = [];
  for (let idx = 0; idx < MAX_RANGES_PER_DAY; idx++) {
    const open = formData.get(`${prefix}_open_${idx}`);
    const close = formData.get(`${prefix}_close_${idx}`);
    if (!open || !close) continue;
    ranges.push({ open_time: String(open), close_time: String(close) });
  }
  return ranges;
}

// Reads a full week of ranges off a WeeklyHoursFields-rendered form (prefixes "d0".."d6").
function parseWeeklyRanges(formData: FormData) {
  return DAYS.flatMap((day) =>
    parseRanges(formData, `d${day}`).map((r) => ({ day_of_week: day, ...r }))
  );
}

export async function createLocation(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const name = String(formData.get("name"));
  const address = String(formData.get("address") || "") || null;
  const timezone = String(formData.get("timezone") || "UTC");

  const supabase = await createClient();
  const { error } = await supabase.from("locations").insert({
    org_id: orgId,
    name,
    address,
    timezone,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  redirect("/admin?location_added=1");
}

export async function updateLocation(formData: FormData) {
  const locationId = String(formData.get("location_id"));
  const name = String(formData.get("name"));
  const address = String(formData.get("address") || "") || null;
  const timezone = String(formData.get("timezone") || "UTC");

  const supabase = await createClient();
  const { error } = await supabase
    .from("locations")
    .update({ name, address, timezone })
    .eq("id", locationId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/locations/${locationId}`);
  revalidatePath("/");
  revalidatePath(`/locations/${locationId}`, "layout");
  redirect(`/admin/locations/${locationId}?location_saved=1`);
}

export async function createCourt(formData: FormData) {
  const locationId = String(formData.get("location_id"));
  const name = String(formData.get("name"));
  const surfaceType = String(formData.get("surface_type") || "") || null;
  const notes = String(formData.get("notes") || "") || null;
  const slotSizeMinutes = Number(formData.get("slot_size_minutes")) === 30 ? 30 : 60;

  const supabase = await createClient();
  const { error } = await supabase.from("courts").insert({
    location_id: locationId,
    name,
    surface_type: surfaceType,
    notes,
    slot_size_minutes: slotSizeMinutes,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}?court_added=1`);
}

export async function updateCourt(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const name = String(formData.get("name"));
  const surfaceType = String(formData.get("surface_type") || "") || null;
  const notes = String(formData.get("notes") || "") || null;
  const slotSizeMinutes = Number(formData.get("slot_size_minutes")) === 30 ? 30 : 60;

  const supabase = await createClient();
  const { error } = await supabase
    .from("courts")
    .update({ name, surface_type: surfaceType, notes, slot_size_minutes: slotSizeMinutes })
    .eq("id", courtId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}`);
  revalidatePath(`/locations/${locationId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}?court_saved=${courtId}`);
}

export async function updateCourtActive(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const isActive = String(formData.get("is_active")) === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("courts")
    .update({ is_active: !isActive })
    .eq("id", courtId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}`);
  revalidatePath("/");
  revalidatePath(`/locations/${locationId}`);
  redirect(`/admin/locations/${locationId}?active_changed=${courtId}`);
}

export async function saveAvailability(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id") || "");
  const supabase = await createClient();

  const rows = parseWeeklyRanges(formData).map((r) => ({ court_id: courtId, ...r }));

  // Full-week replace: simplest correct model (each day can carry more
  // than one row now, for split hours like 9am-12pm and 4-9pm).
  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("court_id", courtId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("availability_rules").insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  if (locationId) {
    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    redirect(`/admin/locations/${locationId}/courts/${courtId}?saved=1`);
  }
}

// Applies one weekly schedule to every court at a location in one action --
// a shortcut over editing each court's availability individually. This
// overwrites each court's existing weekly rules entirely.
export async function applyLocationHours(formData: FormData) {
  const locationId = String(formData.get("location_id"));
  const supabase = await createClient();

  const weeklyRows = parseWeeklyRanges(formData);

  const { data: courts, error: courtsError } = await supabase
    .from("courts")
    .select("id")
    .eq("location_id", locationId);

  if (courtsError) {
    throw new Error(courtsError.message);
  }

  const courtIds = (courts ?? []).map((c) => c.id);

  if (courtIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("availability_rules")
      .delete()
      .in("court_id", courtIds);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    if (weeklyRows.length > 0) {
      const rows = courtIds.flatMap((courtId) =>
        weeklyRows.map((r) => ({ court_id: courtId, ...r }))
      );
      const { error: insertError } = await supabase.from("availability_rules").insert(rows);
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  revalidatePath(`/admin/locations/${locationId}`);
  revalidatePath(`/locations/${locationId}`, "layout");
  redirect(`/admin/locations/${locationId}?hours_applied=1`);
}

// Sets (replacing any existing override rows) the custom hours for one
// specific date on one court -- e.g. blocking off part of a day for
// maintenance, or opening later/closing earlier for a holiday. Marking the
// day fully closed takes precedence over any ranges also submitted.
export async function saveDateOverride(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const date = String(formData.get("date"));
  const isClosed = formData.get("is_closed") === "on";
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("slot_overrides")
    .delete()
    .eq("court_id", courtId)
    .eq("date", date);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (isClosed) {
    const { error: insertError } = await supabase
      .from("slot_overrides")
      .insert({ court_id: courtId, date, is_closed: true });
    if (insertError) {
      throw new Error(insertError.message);
    }
  } else {
    const ranges = parseRanges(formData, "date");
    if (ranges.length > 0) {
      const rows = ranges.map((r) => ({
        court_id: courtId,
        date,
        is_closed: false,
        custom_open: r.open_time,
        custom_close: r.close_time,
      }));
      const { error: insertError } = await supabase.from("slot_overrides").insert(rows);
      if (insertError) {
        throw new Error(insertError.message);
      }
    }
  }

  revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}/courts/${courtId}?override_saved=${date}`);
}

// Removes any custom hours for one date, falling back to the court's
// regular weekly schedule for that day again.
export async function clearDateOverride(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const date = String(formData.get("date"));
  const supabase = await createClient();

  const { error } = await supabase
    .from("slot_overrides")
    .delete()
    .eq("court_id", courtId)
    .eq("date", date);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}/courts/${courtId}?override_cleared=${date}`);
}

export async function updateBookingConfig(formData: FormData) {
  const bookingId = String(formData.get("booking_id"));
  const locationId = String(formData.get("location_id"));
  const courtId = String(formData.get("court_id"));
  const requestedNetHeight = String(formData.get("requested_net_height") || "") || null;
  const requestedCourtLines = String(formData.get("requested_court_lines") || "") || null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("bookings")
    .update({
      requested_net_height: requestedNetHeight,
      requested_court_lines: requestedCourtLines,
    })
    .eq("id", bookingId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}/courts/${courtId}?config_saved=${bookingId}`);
}
