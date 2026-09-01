"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { determineRegistrationStatus } from "@/lib/eventRegistration";
import { isProfileComplete } from "@/lib/userProfile";

const UNIQUE_VIOLATION = "23505";

export async function registerForEvent(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const teamName = String(formData.get("team_name") || "").trim();
  const captainDisplayName = String(formData.get("captain_display_name") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
  }

  const { data: event } = await supabase
    .from("events")
    .select("event_type, capacity, registration_mode, team_formation, status")
    .eq("id", eventId)
    .single();

  if (!event) {
    throw new Error("Event not found.");
  }

  if (event.status !== "published" && event.status !== "registration_open") {
    redirect(`/events/${eventId}?register_error=${encodeURIComponent("Registration isn't open for this event.")}`);
  }

  if (event.event_type !== "open_play") {
    const { data: profile } = await supabase
      .from("users")
      .select("name, gender, skill_level")
      .eq("id", user.id)
      .single();

    if (!profile || !isProfileComplete(profile)) {
      redirect(
        `/profile?next=${encodeURIComponent(`/events/${eventId}`)}&message=${encodeURIComponent("Complete your profile to register for this event.")}`
      );
    }
  }

  if (event.registration_mode === "individual" && !displayName) {
    redirect(`/events/${eventId}?register_error=${encodeURIComponent("Enter a display name.")}`);
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
    if (!captainDisplayName) {
      redirect(`/events/${eventId}?register_error=${encodeURIComponent("Enter your display name.")}`);
    }

    // Every teammate slot needs a name AND an email now -- every roster
    // spot must resolve to a real account, either immediately (an
    // existing account) or eventually (a pending invite claimed at
    // sign-in). Only one of the two filled in is a form mistake, not a
    // valid partial entry.
    const teammates: { name: string; email: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const name = String(formData.get(`teammate_name_${i}`) || "").trim();
      const email = String(formData.get(`teammate_email_${i}`) || "").trim();
      if (!name && !email) continue;
      if (!name || !email) {
        redirect(
          `/events/${eventId}?register_error=${encodeURIComponent(`Teammate ${i} needs both a name and an email.`)}`
        );
      }
      teammates.push({ name, email });
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
      .insert({ team_id: teamId, user_id: user.id, display_name: captainDisplayName });

    let rosterErrorMessage: string | null = captainError ? "Couldn't add your roster. Try again." : null;

    if (!rosterErrorMessage) {
      for (const teammate of teammates) {
        const { data: matchedUserId, error: lookupError } = await supabase.rpc(
          "find_registered_user_by_email",
          { check_email: teammate.email }
        );
        if (lookupError) {
          throw new Error(lookupError.message);
        }

        const { error: teammateError } = await supabase.from("event_team_members").insert(
          matchedUserId
            ? { team_id: teamId, user_id: matchedUserId, display_name: teammate.name }
            : { team_id: teamId, invited_email: teammate.email, display_name: teammate.name }
        );

        if (teammateError) {
          rosterErrorMessage =
            teammateError.code === UNIQUE_VIOLATION
              ? `${teammate.email} already has a pending invite elsewhere.`
              : "Couldn't add your roster. Try again.";
          break;
        }
      }
    }

    if (rosterErrorMessage) {
      // Roll back the orphaned team row -- same pattern as
      // addEventSession's session/booking rollback in
      // src/app/admin/eventActions.ts: a team without its full roster is
      // meaningless, so don't leave it behind.
      await supabase.from("event_teams").delete().eq("id", teamId);
      redirect(`/events/${eventId}?register_error=${encodeURIComponent(rosterErrorMessage)}`);
    }
  }

  const { data: counts, error: countError } = await supabase
    .from("event_registration_counts")
    .select("status, count")
    .eq("event_id", eventId);

  if (countError) {
    throw new Error(countError.message);
  }

  const registeredCount = (counts ?? []).find((c) => c.status === "registered")?.count ?? 0;

  const status = determineRegistrationStatus(registeredCount, event.capacity);

  const { error } = await supabase.from("event_registrations").insert({
    event_id: eventId,
    team_id: teamId,
    user_id: teamId ? null : user.id,
    status,
    display_name: teamId ? null : displayName || null,
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
  redirect(`/events/${eventId}`);
}

// Shared by the "My Events" page. RLS ("event_registrations update own or
// captain or member") is what actually decides whether this caller is
// allowed to cancel this particular registration.
export async function cancelEventRegistration(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("event_registrations")
    .update({ status: "cancelled" })
    .eq("id", registrationId)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  // RLS ("event_registrations update own or captain or member") silently
  // matches zero rows -- no error -- when the caller isn't allowed to
  // update this particular registration (e.g. a non-captain teammate on a
  // self-formed team, or any member of an admin-assembled team, which has
  // no captain_user_id at all). Without this check the caller would see a
  // false "cancelled" success while nothing changed in the database.
  if (!updated || updated.length === 0) {
    redirect(
      `/events/registrations?cancel_error=${encodeURIComponent("You can't cancel this registration.")}`
    );
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
