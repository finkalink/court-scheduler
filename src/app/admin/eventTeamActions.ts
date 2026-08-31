"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { determineRegistrationStatus } from "@/lib/eventRegistration";

export async function assembleEventTeam(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const teamName = String(formData.get("team_name") || "").trim();
  const registrationIds = formData.getAll("registration_id").map(String);

  const supabase = await createClient();

  if (!teamName || registrationIds.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?assemble_error=${encodeURIComponent("Pick a team name and at least one registrant.")}`
    );
  }

  const { data: event } = await supabase.from("events").select("capacity").eq("id", eventId).single();
  if (!event) {
    throw new Error("Event not found.");
  }

  const { data: emailRows, error: emailError } = await supabase.rpc(
    "list_event_registrant_emails",
    { check_event_id: eventId }
  );
  if (emailError) {
    throw new Error(emailError.message);
  }
  const emailByUserId = new Map(
    (emailRows ?? []).map((r: { user_id: string; email: string }) => [r.user_id, r.email])
  );

  const { data: registrations, error: regError } = await supabase
    .from("event_registrations")
    .select("id, user_id, status")
    .in("id", registrationIds);
  if (regError) {
    throw new Error(regError.message);
  }

  const { data: team, error: teamError } = await supabase
    .from("event_teams")
    .insert({ event_id: eventId, name: teamName })
    .select("id")
    .single();
  if (teamError) {
    throw new Error(teamError.message);
  }

  for (const reg of registrations ?? []) {
    const displayName = (reg.user_id && emailByUserId.get(reg.user_id)) || "Player";
    const { error: memberError } = await supabase
      .from("event_team_members")
      .insert({ team_id: team.id, user_id: reg.user_id, display_name: displayName });
    if (memberError) {
      throw new Error(memberError.message);
    }
  }

  // The individual registrations are consumed into the new team-level
  // registration -- delete the per-player rows, insert one row for the team.
  const { error: deleteError } = await supabase
    .from("event_registrations")
    .delete()
    .in("id", registrationIds);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { data: counts, error: countError } = await supabase
    .from("event_registration_counts")
    .select("status, count")
    .eq("event_id", eventId);
  if (countError) {
    throw new Error(countError.message);
  }
  const currentRegisteredCount = (counts ?? []).find((c) => c.status === "registered")?.count ?? 0;
  const registeredAmongSelected = (registrations ?? []).filter((r) => r.status === "registered").length;
  const countAfterRemoval = Math.max(0, currentRegisteredCount - registeredAmongSelected);
  const newStatus = determineRegistrationStatus(countAfterRemoval, event.capacity);

  const { error: insertError } = await supabase
    .from("event_registrations")
    .insert({ event_id: eventId, team_id: team.id, status: newStatus });
  if (insertError) {
    throw new Error(insertError.message);
  }

  await supabase.rpc("promote_next_waitlisted", { p_event_id: eventId });

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect(`/admin/locations/${locationId}/events/${eventId}?team_assembled=1`);
}
