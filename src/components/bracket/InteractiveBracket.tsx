"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventMatch } from "@/lib/matchAdvancement";
import type { EventMatchSetRow } from "@/lib/bracketryData";
import { computeActiveRounds } from "@/lib/activeRounds";
import { computeStandings } from "@/lib/standings";
import BracketryTreeView from "@/components/bracket/BracketryTreeView";
import MatchCardGrid from "@/components/bracket/MatchCardGrid";
import MatchResultSheet from "@/components/bracket/MatchResultSheet";

const ELIMINATION_BRACKETS = new Set(["winners", "losers", "playoff"]);

interface InteractiveBracketProps {
  eventId: string;
  locationId: string;
  matches: EventMatch[];
  sets: EventMatchSetRow[];
  nameByRegistrationId: Map<string, string>;
  bestOfSets: number;
  pointsPerSet: number;
  winBy: number;
  interactive: boolean;
}

export default function InteractiveBracket({
  eventId,
  locationId,
  matches,
  sets,
  nameByRegistrationId,
  bestOfSets,
  pointsPerSet,
  winBy,
  interactive,
}: InteractiveBracketProps) {
  const router = useRouter();
  const [openMatch, setOpenMatch] = useState<EventMatch | null>(null);
  const [reviewNeededIds, setReviewNeededIds] = useState<string[]>([]);

  const activeRounds = computeActiveRounds(matches.filter((m) => ELIMINATION_BRACKETS.has(m.bracket)));
  const bracketGroups = Array.from(new Set(matches.map((m) => m.bracket)));

  return (
    <div className="flex flex-col gap-8">
      {reviewNeededIds.length > 0 && (
        <div className="rounded bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
          <p>
            This correction fed into {reviewNeededIds.length} match{reviewNeededIds.length > 1 ? "es" : ""} that{" "}
            {reviewNeededIds.length > 1 ? "were" : "was"} already completed, so it wasn&apos;t auto-updated. Tap it
            to review and, if needed, correct it.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {reviewNeededIds.map((id) => {
              const m = matches.find((match) => match.id === id);
              if (!m) return <li key={id}>Match {id}</li>;
              return (
                <li key={id}>
                  {m.bracket} round {m.round_number}: {nameByRegistrationId.get(m.team_a_registration_id ?? "") ?? "TBD"} vs{" "}
                  {nameByRegistrationId.get(m.team_b_registration_id ?? "") ?? "TBD"}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {bracketGroups.map((bracket) => {
        const bracketMatches = matches.filter((m) => m.bracket === bracket);
        const isElimination = ELIMINATION_BRACKETS.has(bracket);
        const registrationIdsInBracket = Array.from(
          new Set(
            bracketMatches
              .flatMap((m) => [m.team_a_registration_id, m.team_b_registration_id])
              .filter((id): id is string => Boolean(id))
          )
        );

        return (
          <div key={bracket}>
            <h2 className="mb-2 text-lg font-medium capitalize">{bracket.replace(/_/g, " ")}</h2>
            {isElimination ? (
              <BracketryTreeView
                matches={bracketMatches}
                sets={sets}
                nameByRegistrationId={nameByRegistrationId}
                activeRound={activeRounds[bracket] ?? 1}
                interactive={interactive}
                onMatchTap={setOpenMatch}
              />
            ) : (
              <MatchCardGrid
                matches={bracketMatches}
                standings={computeStandings(bracketMatches, sets, registrationIdsInBracket)}
                nameByRegistrationId={nameByRegistrationId}
                onMatchTap={setOpenMatch}
              />
            )}
          </div>
        );
      })}

      {openMatch && (
        <MatchResultSheet
          match={openMatch}
          eventId={eventId}
          locationId={locationId}
          nameByRegistrationId={nameByRegistrationId}
          existingSets={sets.filter((s) => s.match_id === openMatch.id)}
          bestOfSets={bestOfSets}
          pointsPerSet={pointsPerSet}
          winBy={winBy}
          interactive={interactive}
          onClose={() => setOpenMatch(null)}
          onSuccess={(reviewNeeded) => {
            setOpenMatch(null);
            setReviewNeededIds(reviewNeeded);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
