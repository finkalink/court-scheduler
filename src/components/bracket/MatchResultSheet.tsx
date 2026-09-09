"use client";

import { useActionState, useEffect } from "react";
import { recordMatchResult, type MatchResultState } from "@/app/admin/eventMatchActions";
import { buttonClass } from "@/lib/buttonStyles";
import type { EventMatch } from "@/lib/matchAdvancement";
import type { EventMatchSetRow } from "@/lib/bracketryData";

interface MatchResultSheetProps {
  match: EventMatch;
  eventId: string;
  locationId: string;
  nameByRegistrationId: Map<string, string>;
  existingSets: EventMatchSetRow[];
  bestOfSets: number;
  pointsPerSet: number;
  winBy: number;
  interactive: boolean;
  onClose: () => void;
  onSuccess: (reviewNeeded: string[]) => void;
}

export default function MatchResultSheet({
  match,
  eventId,
  locationId,
  nameByRegistrationId,
  existingSets,
  bestOfSets,
  pointsPerSet,
  winBy,
  interactive,
  onClose,
  onSuccess,
}: MatchResultSheetProps) {
  const [state, formAction, isPending] = useActionState<MatchResultState | null, FormData>(
    recordMatchResult,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      onSuccess(state.reviewNeeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const sideAName = nameByRegistrationId.get(match.team_a_registration_id ?? "") ?? "TBD";
  const sideBName = nameByRegistrationId.get(match.team_b_registration_id ?? "") ?? "TBD";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-card p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
        <p className="text-sm font-medium">
          {sideAName} vs {sideBName}
        </p>
        {match.admin_note && (
          <p className="text-xs italic text-fg-muted">{match.admin_note}</p>
        )}

        {!interactive && (
          <div className="mt-3 text-sm">
            {existingSets.length === 0 && (
              <p className="text-fg-muted">No sets recorded yet.</p>
            )}
            {[...existingSets]
              .sort((a, b) => a.set_number - b.set_number)
              .map((s) => (
                <p key={s.set_number}>
                  Set {s.set_number}: {s.team_a_points}-{s.team_b_points}
                </p>
              ))}
            {match.is_forfeit && <p className="text-fg-muted">Forfeit</p>}
            {match.winner_registration_id && (
              <p className="mt-1 font-medium">
                Winner: {nameByRegistrationId.get(match.winner_registration_id)}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`mt-4 w-full ${buttonClass("secondary")}`}
            >
              Close
            </button>
          </div>
        )}

        {interactive && (
          <form action={formAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="match_id" value={match.id} />
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="location_id" value={locationId} />
            <p className="text-xs text-fg-muted">
              First to {pointsPerSet}, win by {winBy}
            </p>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="w-10" />
              <span className="w-20 truncate">{sideAName}</span>
              <span className="w-3" />
              <span className="w-20 truncate">{sideBName}</span>
            </div>
            {Array.from({ length: bestOfSets }, (_, i) => i + 1).map((n) => {
              const existing = existingSets.find((s) => s.set_number === n);
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="w-10">Set {n}</span>
                  <input
                    name={`set_${n}_a`}
                    type="number"
                    min="0"
                    defaultValue={existing?.team_a_points ?? ""}
                    className="w-20 rounded border border-border px-2 py-1"
                  />
                  <span>-</span>
                  <input
                    name={`set_${n}_b`}
                    type="number"
                    min="0"
                    defaultValue={existing?.team_b_points ?? ""}
                    className="w-20 rounded border border-border px-2 py-1"
                  />
                </div>
              );
            })}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" name="forfeit" defaultChecked={match.is_forfeit} /> Forfeit / walkover instead
            </label>
            <select
              name="forfeit_winner"
              defaultValue={match.is_forfeit ? (match.winner_registration_id ?? "") : ""}
              className="rounded border border-border bg-card px-2 py-1 text-xs"
            >
              <option value="">Forfeit winner (if checked above)</option>
              {match.team_a_registration_id && (
                <option value={match.team_a_registration_id}>{sideAName}</option>
              )}
              {match.team_b_registration_id && (
                <option value={match.team_b_registration_id}>{sideBName}</option>
              )}
            </select>
            {state?.ok === false && (
              <p className="rounded bg-error-bg p-2 text-xs text-error-fg">
                {state.error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className={`flex-1 disabled:opacity-50 ${buttonClass("primary")}`}
              >
                {isPending ? "Saving..." : "Save Result"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={buttonClass("secondary")}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
