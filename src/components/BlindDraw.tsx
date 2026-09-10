"use client";

import { useActionState, useState } from "react";
import {
  proposeBlindDraw,
  commitBlindDraw,
  type BlindDrawProposalState,
  type BlindDrawTeam,
} from "@/app/admin/eventTeamActions";
import { SKILL_LEVELS } from "@/lib/blindDraw";
import { buttonClass } from "@/lib/buttonStyles";

interface Registrant {
  id: string;
  displayName: string;
  skillLevel: string | null;
}

export default function BlindDraw({
  eventId,
  locationId,
  registrants,
}: {
  eventId: string;
  locationId: string;
  registrants: Registrant[];
}) {
  const [state, formAction, isPending] = useActionState<BlindDrawProposalState | null, FormData>(
    proposeBlindDraw,
    null
  );
  // Reset local editable state whenever a new proposal comes back from the
  // server action -- the sanctioned "adjust state during render" pattern
  // (guarded by a reference-equality check against the previous state),
  // not an effect, since useActionState hands back a new object reference
  // on every dispatch even if a prior proposal is resubmitted unchanged.
  const [committedState, setCommittedState] = useState(state);
  const [teams, setTeams] = useState<BlindDrawTeam[] | null>(null);
  if (state !== committedState) {
    setCommittedState(state);
    setTeams(state?.ok ? state.teams : null);
  }
  const nameById = new Map(state?.ok ? state.registrants.map((r) => [r.id, r.displayName]) : []);

  if (teams) {
    const moveMember = (memberId: string, toTeamIndex: number) => {
      setTeams((prev) => {
        if (!prev) return prev;
        return prev.map((team, i) => {
          if (i === toTeamIndex) {
            return team.memberIds.includes(memberId)
              ? team
              : { ...team, memberIds: [...team.memberIds, memberId] };
          }
          return { ...team, memberIds: team.memberIds.filter((id) => id !== memberId) };
        });
      });
    };

    const renameTeam = (index: number, name: string) => {
      setTeams((prev) => (prev ? prev.map((t, i) => (i === index ? { ...t, name } : t)) : prev));
    };

    return (
      <div className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          Review the proposed teams below, move anyone to a different team if needed, then confirm.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
          {teams.map((team, teamIndex) => (
            <div key={teamIndex} className="min-w-[14rem] flex-1 rounded border border-border p-3">
              <input
                value={team.name}
                onChange={(e) => renameTeam(teamIndex, e.target.value)}
                className="w-full rounded border border-border bg-card px-2 py-1 text-sm font-medium"
              />
              <ul className="mt-2 flex flex-col gap-2">
                {team.memberIds.map((memberId) => (
                  <li key={memberId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{nameById.get(memberId) ?? memberId}</span>
                    <select
                      value={teamIndex}
                      onChange={(e) => moveMember(memberId, Number(e.target.value))}
                      className="rounded border border-border bg-card px-1 py-0.5 text-xs"
                    >
                      {teams.map((t, i) => (
                        <option key={i} value={i}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
                {team.memberIds.length === 0 && (
                  <li className="text-xs italic text-fg-muted">Empty</li>
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <form action={commitBlindDraw}>
            <input type="hidden" name="event_id" value={eventId} />
            <input type="hidden" name="location_id" value={locationId} />
            <input type="hidden" name="teams_json" value={JSON.stringify(teams)} />
            <button type="submit" className={buttonClass("primary")}>
              Confirm Teams
            </button>
          </form>
          <button
            type="button"
            onClick={() => setTeams(null)}
            className={buttonClass("secondary")}
          >
            Start Over
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <label className="flex flex-col gap-1 text-sm">
        Target team size
        <input
          name="target_team_size"
          type="number"
          min="1"
          required
          defaultValue={6}
          className="max-w-[8rem] rounded border border-border px-3 py-2"
        />
      </label>
      <div className="flex flex-col gap-2">
        {registrants.map((reg) => (
          <label key={reg.id} className="flex items-center gap-2 text-sm">
            <span className="w-48 truncate">{reg.displayName}</span>
            <select
              name={`skill_level_${reg.id}`}
              required
              defaultValue={reg.skillLevel ?? ""}
              className="rounded border border-border bg-card px-2 py-1 text-sm"
            >
              <option value="">-- rating --</option>
              {SKILL_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {state?.ok === false && (
        <p className="rounded bg-error-bg p-2 text-sm text-error-fg">{state.error}</p>
      )}
      <button type="submit" disabled={isPending} className={`w-fit disabled:opacity-50 ${buttonClass("primary")}`}>
        {isPending ? "Drawing..." : "Draw Teams"}
      </button>
    </form>
  );
}
