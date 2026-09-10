"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { determineRegistrationStatus } from "@/lib/eventRegistration";
import { drawBalancedTeams, type DrawRegistrant } from "@/lib/blindDraw";

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
    .select("id, user_id")
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
  // This count is read after the individual registrations above were
  // already deleted, so it already excludes them -- no further
  // subtraction needed here (an earlier version double-subtracted their
  // count, undercounting and wrongly marking a team 'registered' when it
  // should have been 'waitlisted').
  const newStatus = determineRegistrationStatus(currentRegisteredCount, event.capacity);

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

export interface BlindDrawRegistrant {
  id: string;
  displayName: string;
  skillLevel: string;
}

export interface BlindDrawTeam {
  name: string;
  memberIds: string[];
}

export type BlindDrawProposalState =
  | { ok: true; registrants: BlindDrawRegistrant[]; teams: BlindDrawTeam[] }
  | { ok: false; error: string };

// Always recomputes the ungrouped-registrant pool from the DB rather than
// trusting the form -- same "server never trusts a client-supplied
// membership list" posture as assembleEventTeam re-selecting registrations
// by id instead of taking names/status from the form.
export async function proposeBlindDraw(
  _prevState: BlindDrawProposalState | null,
  formData: FormData
): Promise<BlindDrawProposalState> {
  const eventId = String(formData.get("event_id"));
  const targetTeamSize = Number(formData.get("target_team_size"));

  if (!Number.isInteger(targetTeamSize) || targetTeamSize < 1) {
    return { ok: false, error: "Enter a target team size of at least 1." };
  }

  const supabase = await createClient();

  const { data: ungrouped, error: ungroupedError } = await supabase
    .from("event_registrations")
    .select("id, user_id")
    .eq("event_id", eventId)
    .is("team_id", null)
    .neq("status", "cancelled");
  if (ungroupedError) {
    return { ok: false, error: ungroupedError.message };
  }
  if (!ungrouped || ungrouped.length === 0) {
    return { ok: false, error: "No ungrouped registrants right now." };
  }

  const { data: profiles, error: profilesError } = await supabase.rpc(
    "list_event_registrant_profiles",
    { check_event_id: eventId }
  );
  if (profilesError) {
    return { ok: false, error: profilesError.message };
  }
  const emailByUserId = new Map<string, string>(
    (profiles ?? []).map((p: { user_id: string; email: string; skill_level: string | null }) => [
      p.user_id,
      p.email,
    ])
  );
  const skillLevelByUserId = new Map<string, string | null>(
    (profiles ?? []).map((p: { user_id: string; email: string; skill_level: string | null }) => [
      p.user_id,
      p.skill_level,
    ])
  );

  const registrants: BlindDrawRegistrant[] = [];
  const missingRatings: string[] = [];
  for (const reg of ungrouped) {
    const overrideSkillLevel = String(formData.get(`skill_level_${reg.id}`) || "").trim();
    const profileSkillLevel = reg.user_id ? skillLevelByUserId.get(reg.user_id) : null;
    const skillLevel = overrideSkillLevel || profileSkillLevel || "";
    const displayName = (reg.user_id && emailByUserId.get(reg.user_id)) || reg.user_id || "Unknown";
    if (!skillLevel) {
      missingRatings.push(displayName);
      continue;
    }
    registrants.push({ id: reg.id, displayName, skillLevel });
  }

  if (missingRatings.length > 0) {
    return {
      ok: false,
      error: `Set a skill rating for every registrant before drawing: ${missingRatings.join(", ")}.`,
    };
  }

  const drawn = drawBalancedTeams(registrants as DrawRegistrant[], targetTeamSize);
  const teams: BlindDrawTeam[] = drawn.map((t, i) => ({
    name: `Team ${i + 1}`,
    memberIds: t.memberIds,
  }));

  return { ok: true, registrants, teams };
}

export async function commitBlindDraw(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const teams: BlindDrawTeam[] = JSON.parse(String(formData.get("teams_json") || "[]")).filter(
    (t: BlindDrawTeam) => t.memberIds.length > 0
  );

  if (teams.length === 0) {
    redirect(
      `/admin/locations/${locationId}/events/${eventId}?blind_draw_error=${encodeURIComponent("No teams to create.")}`
    );
  }

  const supabase = await createClient();

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

  for (const team of teams) {
    const { data: registrations, error: regError } = await supabase
      .from("event_registrations")
      .select("id, user_id")
      .in("id", team.memberIds);
    if (regError) {
      throw new Error(regError.message);
    }

    const { data: teamRow, error: teamError } = await supabase
      .from("event_teams")
      .insert({ event_id: eventId, name: team.name })
      .select("id")
      .single();
    if (teamError) {
      throw new Error(teamError.message);
    }

    for (const reg of registrations ?? []) {
      const displayName = (reg.user_id && emailByUserId.get(reg.user_id)) || "Player";
      const { error: memberError } = await supabase
        .from("event_team_members")
        .insert({ team_id: teamRow.id, user_id: reg.user_id, display_name: displayName });
      if (memberError) {
        throw new Error(memberError.message);
      }
    }

    const { error: deleteError } = await supabase
      .from("event_registrations")
      .delete()
      .in("id", team.memberIds);
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
    const newStatus = determineRegistrationStatus(currentRegisteredCount, event.capacity);

    const { error: insertError } = await supabase
      .from("event_registrations")
      .insert({ event_id: eventId, team_id: teamRow.id, status: newStatus });
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  await supabase.rpc("promote_next_waitlisted", { p_event_id: eventId });

  revalidatePath(`/admin/locations/${locationId}/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect(`/admin/locations/${locationId}/events/${eventId}?blind_draw_committed=${teams.length}`);
}
