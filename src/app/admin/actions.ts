"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateSlotOverride } from "@/lib/slotOverride";
import { wouldRemoveLastOwner, type OrgRole } from "@/lib/orgRoles";
import type { SupabaseClient } from "@supabase/supabase-js";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

function rulesFromFormData(courtId: string, formData: FormData) {
  return DAYS.map((day) => {
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
}

// Full-week replace: simplest correct model for v1 (one rule per day).
async function replaceAvailabilityRules(
  supabase: SupabaseClient,
  courtId: string,
  rows: ReturnType<typeof rulesFromFormData>
) {
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
}

function geocodeFieldsFromFormData(formData: FormData) {
  const postalCode = String(formData.get("postal_code") || "") || null;
  const latitude = formData.get("latitude");
  const longitude = formData.get("longitude");
  const formattedAddress = String(formData.get("formatted_address") || "") || null;

  return {
    postal_code: postalCode,
    latitude: latitude ? Number(latitude) || null : null,
    longitude: longitude ? Number(longitude) || null : null,
    formatted_address: formattedAddress,
  };
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
    ...geocodeFieldsFromFormData(formData),
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
    .update({ name, address, timezone, ...geocodeFieldsFromFormData(formData) })
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

  await replaceAvailabilityRules(supabase, courtId, rulesFromFormData(courtId, formData));

  if (locationId) {
    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    redirect(`/admin/locations/${locationId}/courts/${courtId}?saved=1`);
  }
}

// Writes the same weekly hours (already validated/confirmed by the caller)
// into every court at the location, overwriting each court's existing
// availability_rules.
export async function pushHoursToAllCourts(formData: FormData) {
  const locationId = String(formData.get("location_id"));
  const supabase = await createClient();

  const { data: courts, error: courtsError } = await supabase
    .from("courts")
    .select("id")
    .eq("location_id", locationId);

  if (courtsError) {
    throw new Error(courtsError.message);
  }

  for (const court of courts ?? []) {
    await replaceAvailabilityRules(supabase, court.id, rulesFromFormData(court.id, formData));
  }

  revalidatePath(`/admin/locations/${locationId}`);
  for (const court of courts ?? []) {
    revalidatePath(`/admin/locations/${locationId}/courts/${court.id}`);
    revalidatePath(`/locations/${locationId}/courts/${court.id}`);
  }
  redirect(`/admin/locations/${locationId}?hours_pushed=1`);
}

export async function saveSlotOverride(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));

  const result = validateSlotOverride({
    date: String(formData.get("date") || ""),
    isClosed: formData.get("is_closed") === "on",
    customOpen: String(formData.get("custom_open") || ""),
    customClose: String(formData.get("custom_close") || ""),
  });

  if (!result.valid) {
    redirect(
      `/admin/locations/${locationId}/courts/${courtId}?override_error=${encodeURIComponent(result.error)}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("slot_overrides")
    .upsert({ court_id: courtId, ...result.value }, { onConflict: "court_id,date" });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}/courts/${courtId}?override_saved=1`);
}

export async function deleteSlotOverride(formData: FormData) {
  const overrideId = String(formData.get("override_id"));
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();
  const { error } = await supabase.from("slot_overrides").delete().eq("id", overrideId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
  revalidatePath(`/locations/${locationId}/courts/${courtId}`);
  redirect(`/admin/locations/${locationId}/courts/${courtId}?override_deleted=1`);
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

export async function addOrgMember(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const email = String(formData.get("email") || "").trim();
  const roleInput = String(formData.get("role") || "");
  const role = roleInput === "admin" || roleInput === "staff" ? roleInput : "staff";

  const supabase = await createClient();

  const { data: userId, error: lookupError } = await supabase.rpc("lookup_user_id_by_email", {
    lookup_email: email,
  });

  if (lookupError) {
    throw new Error(lookupError.message);
  }

  if (!userId) {
    redirect(
      `/admin/team?add_error=${encodeURIComponent("No account found for that email — they'll need to sign up first.")}`
    );
  }

  const { error: insertError } = await supabase
    .from("org_members")
    .insert({ org_id: orgId, user_id: userId, role });

  if (insertError) {
    if (insertError.code === "23505") {
      redirect(`/admin/team?add_error=${encodeURIComponent("This person already has access.")}`);
    }
    throw new Error(insertError.message);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?member_added=1");
}

export async function updateOrgMemberRole(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));
  const roleInput = String(formData.get("role") || "");
  const role = roleInput === "admin" || roleInput === "staff" ? roleInput : "staff";

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  const { count: ownerCount } = await supabase
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner");

  if (target && wouldRemoveLastOwner(ownerCount ?? 0, target.role as OrgRole)) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Can't change the club's last owner.")}`);
  }

  const { error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?role_updated=1");
}

export async function removeOrgMember(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));

  const supabase = await createClient();

  const { data: target } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .single();

  const { count: ownerCount } = await supabase
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("role", "owner");

  if (target && wouldRemoveLastOwner(ownerCount ?? 0, target.role as OrgRole)) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Can't change the club's last owner.")}`);
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?member_removed=1");
}
