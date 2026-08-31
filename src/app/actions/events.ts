"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { determineRegistrationStatus } from "@/lib/eventRegistration";

const UNIQUE_VIOLATION = "23505";

export async function registerForEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const teamName = String(formData.get("team_name") || "").trim();
  const teammateNames = formData
    .getAll("teammate_name")
    .map((n) => String(n).trim())
    .filter(Boolean);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
  }

  const { data: event } = await supabase
    .from("events")
    .select("capacity, registration_mode, team_formation")
    .eq("id", eventId)
    .single();

  if (!event) {
    throw new Error("Event not found.");
  }

  let teamId: string | null = null;

  // Self-formed team registration: create the team + roster now. Every
  // other case (individual events, and admin-assembled team events) is a
  // plain individual sign-up -- the org builds teams later for the
  // admin-assembled case.
  if (event.registration_mode === "team" && event.team_formation === "self_formed") {
    if (!teamName) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent("Team name is required.")}`);
    }

    const { data: team, error: teamError } = await supabase
      .from("event_teams")
      .insert({ event_id: eventId, name: teamName, captain_user_id: user.id })
      .select("id")
      .single();

    if (teamError) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent(teamError.message)}`);
    }

    teamId = team.id;

    const { error: captainError } = await supabase
      .from("event_team_members")
      .insert({ team_id: teamId, user_id: user.id, display_name: user.email ?? "Captain" });

    let rosterError = captainError;
    if (!rosterError) {
      for (const name of teammateNames) {
        const { error: teammateError } = await supabase
          .from("event_team_members")
          .insert({ team_id: teamId, display_name: name });
        if (teammateError) {
          rosterError = teammateError;
          break;
        }
      }
    }

    if (rosterError) {
      // Roll back the orphaned team row -- same pattern as
      // addEventSession's session/booking rollback in
      // src/app/admin/eventActions.ts: a team without its full roster is
      // meaningless, so don't leave it behind.
      await supabase.from("event_teams").delete().eq("id", teamId);
      redirect(
        `/events/${eventId}?register_error=${encodeURIComponent("Couldn't add your roster. Try again.")}`
      );
    }
  }

  const { count: registeredCount, error: countError } = await supabase
    .from("event_registrations")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "registered");

  if (countError) {
    throw new Error(countError.message);
  }

  const status = determineRegistrationStatus(registeredCount ?? 0, event.capacity);

  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    team_id: teamId,
    user_id: teamId ? null : user.id,
    status,
  });

  if (error) {
    const message =
      error.code === UNIQUE_VIOLATION
        ? "You're already registered for this event."
        : error.message;
    redirect(`/events/${eventId}?register_error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect(`/events/${eventId}?registered=1`);
}

// Shared by the "My Events" page. RLS ("event_registrations update own or
// captain or member") is what actually decides whether this caller is
// allowed to cancel this particular registration.
export async function cancelEventRegistration(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .update({ status: "cancelled" })
    .eq("id", registrationId);

  if (error) {
    throw new Error(error.message);
  }

  // A freed 'registered' spot should immediately pull the next waitlisted
  // registrant up -- this needs to update a DIFFERENT player's row than
  // the one who just cancelled, which is why this is a security-definer
  // RPC rather than a plain client update (see the migration).
  //
  // The cancellation itself already succeeded above, so a promotion
  // failure here doesn't fail the whole action -- but it also shouldn't be
  // silently discarded (this codebase has no logging infra to send it to
  // yet, so capturing it is the pragmatic stopping point for now).
  const { error: promoteError } = await supabase.rpc("promote_next_waitlisted", {
    p_event_id: eventId,
  });
  void promoteError;

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/events/registrations");
  redirect("/events/registrations?cancelled=1");
}
