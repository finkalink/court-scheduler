"use client";

import type { EventMatch } from "@/lib/matchAdvancement";
import type { StandingsRow } from "@/lib/standings";

interface MatchCardGridProps {
  matches: EventMatch[];
  standings: StandingsRow[] | null;
  nameByRegistrationId: Map<string, string>;
  onMatchTap: (match: EventMatch) => void;
}

// Round robin/pool play have no tree shape and no round-locking -- every
// match is always tappable, grouped by round in a plain grid. Visually
// pulls its card look (border/spacing/typography) from the same
// conventions the surrounding admin/player pages already use, so it
// reads as one system with the bracketry-rendered tree next to it.
export default function MatchCardGrid({ matches, standings, nameByRegistrationId, onMatchTap }: MatchCardGridProps) {
  const rounds = Array.from(new Set(matches.map((m) => m.round_number))).sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-4">
      {standings && (
        <table className="w-full max-w-md text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-600 dark:text-neutral-400">
              <th>Team</th>
              <th>W</th>
              <th>L</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.registrationId}>
                <td>{nameByRegistrationId.get(row.registrationId) ?? "Unknown"}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
                <td>{row.pointDiff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rounds.map((round) => (
        <div key={round}>
          <p className="mb-2 text-xs font-medium text-gray-600 dark:text-neutral-400">Round {round}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {matches
              .filter((m) => m.round_number === round)
              .map((match) => (
                <button
                  key={match.id}
                  type="button"
                  onClick={() => onMatchTap(match)}
                  className="rounded border border-gray-300 px-3 py-2 text-left text-xs hover:bg-gray-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
                >
                  <p>{nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD"}</p>
                  <p>{nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD"}</p>
                  {match.status === "completed" && match.winner_registration_id && (
                    <p className="mt-1 font-medium">
                      Winner: {nameByRegistrationId.get(match.winner_registration_id)}
                    </p>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
