"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  generateSingleElimBracket,
  generateDoubleElimBracket,
  generateRoundRobinMatches,
  generatePoolPlayMatches,
  nextPowerOf2,
  type SeedSlot,
} from "@/lib/bracketGeneration";
import { propagateAdvancement, type EventMatch } from "@/lib/matchAdvancement";
import { deriveMatchWinner } from "@/lib/matchResult";
import { pairMatchesToSessions } from "@/lib/matchScheduling";

function bracketPath(locationId: string, eventId: string) {
  return `/admin/locations/${locationId}/events/${eventId}/bracket`;
}

export async function generateBracket(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const format = String(formData.get("format")); // 'single_elim' | 'double_elim' | 'round_robin' | 'pool_play'
  const seeding = String(formData.get("seeding") || "registration_order"); // 'registration_order' | 'random' | 'manual'
  const byeMode = String(formData.get("bye_mode") || "auto"); // 'auto' | 'manual'

  const supabase = await createClient();

  const { data: registrations } = await supabase
    .from("event_registrations")
    .select("id, registered_at")
    .eq("event_id", eventId)
    .eq("status", "registered")
    .order("registered_at", { ascending: true });

  const regIds = (registrations ?? []).map((r) => r.id);
  if (regIds.length < 2) {
    redirect(
      `${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Need at least 2 registered teams/players to generate a bracket.")}`
    );
  }

  let orderedIds = regIds;
  if (seeding === "random") {
    orderedIds = [...regIds].sort(() => Math.random() - 0.5);
  } else if (seeding === "manual") {
    // The admin form renders a numeric "seed" input per registrant
    // (name="seed_for_<id>"), defaulting to registration order -- sort by
    // whatever the admin typed. Avoids needing client-side drag-and-drop
    // reordering for a plain server-rendered form.
    orderedIds = regIds
      .map((id) => ({ id, seedNumber: Number(formData.get(`seed_for_${id}`) || 0) }))
      .sort((a, b) => a.seedNumber - b.seedNumber)
      .map((r) => r.id);
  }

  let matches: EventMatch[];

  if (format === "single_elim" || format === "double_elim") {
    const bracketSize = nextPowerOf2(orderedIds.length);
    const numByes = bracketSize - orderedIds.length;

    const seeds: SeedSlot[] = orderedIds.map((id, i) => ({ registrationId: id, seed: i + 1 }));
    for (let i = orderedIds.length + 1; i <= bracketSize; i++) {
      seeds.push({ registrationId: null, seed: i });
    }

    if (byeMode === "manual" && numByes > 0) {
      const manualByeSeeds = formData.getAll("bye_seed").map((s) => Number(s));
      if (manualByeSeeds.length === numByes) {
        const currentByeSeeds = seeds.filter((s) => s.registrationId === null).map((s) => s.seed);
        for (let i = 0; i < manualByeSeeds.length; i++) {
          const target = seeds.find((s) => s.seed === manualByeSeeds[i]);
          const placeholder = seeds.find((s) => s.seed === currentByeSeeds[i]);
          if (target && placeholder && target !== placeholder) {
            const temp = target.registrationId;
            target.registrationId = placeholder.registrationId;
            placeholder.registrationId = temp;
          }
        }
      }
    }

    if (format === "double_elim" && bracketSize < 4) {
      redirect(
        `${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Double elimination needs at least 3 registered teams/players.")}`
      );
    }

    matches = format === "single_elim" ? generateSingleElimBracket(seeds, eventId) : generateDoubleElimBracket(seeds, eventId);
  } else if (format === "round_robin") {
    matches = generateRoundRobinMatches(orderedIds, eventId);
  } else if (format === "pool_play") {
    const pools: Record<string, string[]> = {};
    for (const id of orderedIds) {
      const poolLabel = String(formData.get(`pool_for_${id}`) || "pool_a");
      pools[poolLabel] = pools[poolLabel] ?? [];
      pools[poolLabel].push(id);
    }
    matches = generatePoolPlayMatches(pools, eventId);
  } else {
    redirect(`${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Unknown bracket format.")}`);
  }

  const { error } = await supabase.from("event_matches").insert(matches);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(`${bracketPath(locationId, eventId)}?bracket_generated=1`);
}

export async function regenerateBracket(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { count: completedCount } = await supabase
    .from("event_matches")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("status", "completed");

  if ((completedCount ?? 0) > 0) {
    redirect(
      `${bracketPath(locationId, eventId)}?generate_error=${encodeURIComponent("Can't regenerate: results have already been recorded for this bracket.")}`
    );
  }

  const { error } = await supabase.from("event_matches").delete().eq("event_id", eventId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(bracketPath(locationId, eventId));
  redirect(`${bracketPath(locationId, eventId)}?bracket_reset=1`);
}

// Applies a completed match's advancement one hop downstream, writing
// only the two slot columns each affected match actually needs. Returns
// the ids of any downstream matches that were already `completed` and so
// were left untouched instead of overwritten -- the caller surfaces these
// to the admin as a "review this match" banner rather than silently
// cascading further (see the design spec's "Correction cascade" decision).
async function applyAdvancement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  completedMatch: EventMatch,
  eventId: string
): Promise<string[]> {
  const { data: allMatches } = await supabase.from("event_matches").select("*").eq("event_id", eventId);
  const { updatedMatches, secondHopWarnings } = propagateAdvancement(completedMatch, (allMatches ?? []) as EventMatch[]);
  for (const m of updatedMatches) {
    await supabase
      .from("event_matches")
      .update({ team_a_registration_id: m.team_a_registration_id, team_b_registration_id: m.team_b_registration_id })
      .eq("id", m.id);
  }
  return secondHopWarnings.map((m) => m.id);
}

export async function recordMatchResult(formData: FormData) {
  const matchId = String(formData.get("match_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const forfeit = formData.get("forfeit") === "on";
  const forfeitWinner = String(formData.get("forfeit_winner") || "") || null;

  const supabase = await createClient();

  const { data: match } = await supabase.from("event_matches").select("*").eq("id", matchId).single();
  if (!match) {
    throw new Error("Match not found.");
  }

  let winnerId: string | null = null;

  if (forfeit) {
    if (!forfeitWinner) {
      redirect(`${bracketPath(locationId, eventId)}?result_error=${encodeURIComponent("Pick who wins the forfeit.")}`);
    }
    winnerId = forfeitWinner;
  } else {
    const setRows: { match_id: string; set_number: number; team_a_points: number; team_b_points: number }[] = [];
    for (let i = 1; i <= 5; i++) {
      const a = formData.get(`set_${i}_a`);
      const b = formData.get(`set_${i}_b`);
      if (a === null || b === null || a === "" || b === "") continue;
      setRows.push({ match_id: matchId, set_number: i, team_a_points: Number(a), team_b_points: Number(b) });
    }
    if (setRows.length === 0) {
      redirect(
        `${bracketPath(locationId, eventId)}?result_error=${encodeURIComponent("Enter at least one set's score, or mark a forfeit.")}`
      );
    }

    winnerId = deriveMatchWinner(setRows, match.team_a_registration_id, match.team_b_registration_id);
    if (!winnerId) {
      redirect(`${bracketPath(locationId, eventId)}?result_error=${encodeURIComponent("Sets are tied -- can't determine a winner.")}`);
    }

    await supabase.from("event_match_sets").delete().eq("match_id", matchId);
    const { error: setsError } = await supabase.from("event_match_sets").insert(setRows);
    if (setsError) {
      throw new Error(setsError.message);
    }
  }

  const { error } = await supabase
    .from("event_matches")
    .update({ winner_registration_id: winnerId, is_forfeit: forfeit, status: "completed" })
    .eq("id", matchId);
  if (error) {
    throw new Error(error.message);
  }

  const reviewNeeded = await applyAdvancement(
    supabase,
    { ...match, winner_registration_id: winnerId, status: "completed" } as EventMatch,
    eventId
  );

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(
    `${bracketPath(locationId, eventId)}?result_saved=1${reviewNeeded.length > 0 ? `&review_needed=${reviewNeeded.join(",")}` : ""}`
  );
}

export async function editMatch(formData: FormData) {
  const matchId = String(formData.get("match_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const teamA = String(formData.get("team_a_registration_id") || "") || null;
  const teamB = String(formData.get("team_b_registration_id") || "") || null;
  const winnerId = String(formData.get("winner_registration_id") || "") || null;
  const sessionId = String(formData.get("session_id") || "") || null;
  const adminNote = String(formData.get("admin_note") || "").trim() || null;

  const supabase = await createClient();
  const status: EventMatch["status"] = winnerId ? "completed" : sessionId ? "scheduled" : "pending";

  const { error } = await supabase
    .from("event_matches")
    .update({
      team_a_registration_id: teamA,
      team_b_registration_id: teamB,
      winner_registration_id: winnerId,
      session_id: sessionId,
      admin_note: adminNote,
      status,
    })
    .eq("id", matchId);
  if (error) {
    throw new Error(error.message);
  }

  let reviewNeeded: string[] = [];
  if (winnerId) {
    const { data: match } = await supabase.from("event_matches").select("*").eq("id", matchId).single();
    if (match) {
      reviewNeeded = await applyAdvancement(supabase, match as EventMatch, eventId);
    }
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(
    `${bracketPath(locationId, eventId)}?match_edited=1${reviewNeeded.length > 0 ? `&review_needed=${reviewNeeded.join(",")}` : ""}`
  );
}

export async function autoAssignSessions(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));

  const supabase = await createClient();

  const { data: matches } = await supabase
    .from("event_matches")
    .select("id, round_number, slot_in_round")
    .eq("event_id", eventId)
    .eq("status", "pending")
    .is("session_id", null);

  const { data: usedSessionRows } = await supabase
    .from("event_matches")
    .select("session_id")
    .eq("event_id", eventId)
    .not("session_id", "is", null);
  const usedSessionIds = new Set((usedSessionRows ?? []).map((r) => r.session_id));

  const { data: sessions } = await supabase
    .from("event_sessions")
    .select("id, start_time")
    .eq("event_id", eventId)
    .order("start_time");
  const availableSessions = (sessions ?? []).filter((s) => !usedSessionIds.has(s.id));

  const pairs = pairMatchesToSessions(matches ?? [], availableSessions);

  for (const pair of pairs) {
    await supabase
      .from("event_matches")
      .update({ session_id: pair.sessionId, status: "scheduled" })
      .eq("id", pair.matchId);
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(`${bracketPath(locationId, eventId)}?sessions_assigned=${pairs.length}&sessions_total=${(matches ?? []).length}`);
}

export async function withdrawRegistration(formData: FormData) {
  const registrationId = String(formData.get("registration_id"));
  const eventId = String(formData.get("event_id"));
  const locationId = String(formData.get("location_id"));
  const resolution = String(formData.get("resolution") || ""); // 'forfeit' | 'substitute'
  const substituteId = String(formData.get("substitute_registration_id") || "") || null;

  const supabase = await createClient();

  await supabase.from("event_registrations").update({ status: "cancelled" }).eq("id", registrationId);

  const { data: pendingMatch } = await supabase
    .from("event_matches")
    .select("*")
    .eq("event_id", eventId)
    .neq("status", "completed")
    .or(`team_a_registration_id.eq.${registrationId},team_b_registration_id.eq.${registrationId}`)
    .maybeSingle();

  let reviewNeeded: string[] = [];

  if (pendingMatch) {
    const isTeamA = pendingMatch.team_a_registration_id === registrationId;

    if (resolution === "substitute" && substituteId) {
      await supabase
        .from("event_matches")
        .update(isTeamA ? { team_a_registration_id: substituteId } : { team_b_registration_id: substituteId })
        .eq("id", pendingMatch.id);
    } else {
      const opponentId = isTeamA ? pendingMatch.team_b_registration_id : pendingMatch.team_a_registration_id;
      if (opponentId) {
        await supabase
          .from("event_matches")
          .update({
            winner_registration_id: opponentId,
            is_forfeit: true,
            status: "completed",
            admin_note: "Opponent withdrew.",
          })
          .eq("id", pendingMatch.id);

        reviewNeeded = await applyAdvancement(
          supabase,
          { ...pendingMatch, winner_registration_id: opponentId, status: "completed" } as EventMatch,
          eventId
        );
      }
    }
  }

  revalidatePath(bracketPath(locationId, eventId));
  revalidatePath(`/events/${eventId}`);
  redirect(
    `${bracketPath(locationId, eventId)}?withdrawn=1${reviewNeeded.length > 0 ? `&review_needed=${reviewNeeded.join(",")}` : ""}`
  );
}
