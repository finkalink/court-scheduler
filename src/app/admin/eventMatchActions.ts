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
import type { EventMatch } from "@/lib/matchAdvancement";

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
