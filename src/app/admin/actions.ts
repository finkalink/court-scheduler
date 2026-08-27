"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

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

export async function updateCourtNotes(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const notes = String(formData.get("notes") || "") || null;

  const supabase = await createClient();
  const { error } = await supabase.from("courts").update({ notes }).eq("id", courtId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}?notes_saved=${courtId}`);
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

  const rows = DAYS.map((day) => {
    const open = formData.get(`open_${day}`);
    const close = formData.get(`close_${day}`);
    if (!open || !close) return null;
    return {
      court_id: courtId,
      day_of_week: day,
      open_time: String(open),
      close_time: String(close),
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  // Full-week replace: simplest correct model for v1 (one rule per day).
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
