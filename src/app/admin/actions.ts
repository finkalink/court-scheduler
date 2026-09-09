"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateSlotOverride } from "@/lib/slotOverride";
import { canActOnMember, wouldRemoveLastOwner, type OrgRole } from "@/lib/orgRoles";
import { getRoleForOrg } from "@/lib/orgMembership";
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
  const city = String(formData.get("city") || "") || null;
  const latitude = formData.get("latitude");
  const longitude = formData.get("longitude");
  const formattedAddress = String(formData.get("formatted_address") || "") || null;

  return {
    postal_code: postalCode,
    city,
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

export async function updateOrganization(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const venmoHandle = String(formData.get("venmo_handle") || "").trim() || null;

  const supabase = await createClient();

  if (!venmoHandle) {
    const { data: orgLocations } = await supabase.from("locations").select("id").eq("org_id", orgId);
    const locationIds = (orgLocations ?? []).map((l) => l.id);
    if (locationIds.length > 0) {
      const { count } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .in("location_id", locationIds)
        .gt("fee_cents", 0);
      if (count && count > 0) {
        redirect(
          `/admin?org_error=${encodeURIComponent("Can't clear the Venmo handle while a paid event exists — remove the fee from those events first.")}`
        );
      }
    }
  }

  const { data: updated, error } = await supabase
    .from("organizations")
    .update({ venmo_handle: venmoHandle })
    .eq("id", orgId)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    redirect(`/admin?org_error=${encodeURIComponent("Couldn't save club settings.")}`);
  }

  revalidatePath("/admin");
  redirect("/admin?org_updated=1");
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const actorRole = await getRoleForOrg(supabase, user?.id, orgId);
  if (target && (!actorRole || !canActOnMember(actorRole, target.role as OrgRole))) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Only an owner can change another owner's access.")}`);
  }

  const { data: updated, error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    throw new Error(error.message);
  }

  if (!updated || updated.length === 0) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Couldn't update that member's role.")}`);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?role_updated=1");
}

export async function removeOrgMember(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  const actorRole = await getRoleForOrg(supabase, user?.id, orgId);
  if (target && (!actorRole || !canActOnMember(actorRole, target.role as OrgRole))) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Only an owner can remove another owner's access.")}`);
  }

  const { data: removed, error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    throw new Error(error.message);
  }

  if (!removed || removed.length === 0) {
    redirect(`/admin/team?role_error=${encodeURIComponent("Couldn't remove that member.")}`);
  }

  revalidatePath("/admin/team");
  redirect("/admin/team?member_removed=1");
}

export async function createOrganization(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    redirect(`/create-club?error=${encodeURIComponent("Club name is required.")}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, is_active: false })
    .select("id")
    .single();

  if (orgError || !org) {
    redirect(`/create-club?error=${encodeURIComponent(orgError?.message ?? "Couldn't create the club.")}`);
  }

  const { error: memberError } = await supabase
    .from("org_members")
    .insert({ org_id: org.id, user_id: user!.id, role: "owner" });

  if (memberError) {
    // No cleanup here: ordinary users have no DELETE policy on
    // organizations, so this would silently affect zero rows. The
    // orphaned row is inert (is_active=false, ownership_claimed=false,
    // no locations/courts) -- see the spec's Accepted risk section.
    redirect(`/create-club?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/admin");
  redirect("/admin?club_created=1");
}

export async function toggleBlockedSlot(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const mode = String(formData.get("mode"));
  const startTime = String(formData.get("start_time"));
  const currentlyBlocked = String(formData.get("currently_blocked")) === "true";

  const supabase = await createClient();

  if (mode === "recurring") {
    const dayOfWeek = Number(formData.get("day_of_week"));

    if (currentlyBlocked) {
      const { error } = await supabase
        .from("blocked_slots")
        .delete()
        .eq("court_id", courtId)
        .eq("day_of_week", dayOfWeek)
        .eq("start_time", startTime);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("blocked_slots")
        .insert({ court_id: courtId, day_of_week: dayOfWeek, start_time: startTime });
      if (error && error.code !== "23505") throw new Error(error.message);
    }

    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    redirect(
      `/admin/locations/${locationId}/courts/${courtId}?block_mode=recurring&block_day=${dayOfWeek}`
    );
  } else {
    const date = String(formData.get("date"));

    if (currentlyBlocked) {
      const { error } = await supabase
        .from("blocked_slots")
        .delete()
        .eq("court_id", courtId)
        .eq("date", date)
        .eq("start_time", startTime);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("blocked_slots")
        .insert({ court_id: courtId, date, start_time: startTime });
      if (error && error.code !== "23505") throw new Error(error.message);
    }

    revalidatePath(`/admin/locations/${locationId}/courts/${courtId}`);
    revalidatePath(`/locations/${locationId}/courts/${courtId}`);
    redirect(`/admin/locations/${locationId}/courts/${courtId}?block_mode=date&block_date=${date}`);
  }
}
