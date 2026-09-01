"use client";

import { useState } from "react";
import Link from "next/link";

interface MatchCardProps {
  roundLabel: string;
  sideAName: string;
  sideBName: string;
  sideAHref?: string | null;
  sideBHref?: string | null;
  winnerName: string | null;
  sets: { set_number: number; team_a_points: number; team_b_points: number }[];
  isForfeit: boolean;
  adminNote: string | null;
  sessionSummary: string | null;
}

export default function MatchCard({
  roundLabel,
  sideAName,
  sideBName,
  sideAHref = null,
  sideBHref = null,
  winnerName,
  sets,
  isForfeit,
  adminNote,
  sessionSummary,
}: MatchCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded((e) => !e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((x) => !x);
        }
      }}
      className="w-56 shrink-0 rounded border border-gray-300 px-3 py-2 text-left text-sm dark:border-neutral-800"
    >
      <p className="text-xs text-gray-600 dark:text-neutral-400">{roundLabel}</p>
      <p className={winnerName === sideAName ? "font-medium" : ""}>
        {sideAHref ? (
          <Link href={sideAHref} onClick={(e) => e.stopPropagation()} className="underline decoration-dotted">
            {sideAName}
          </Link>
        ) : (
          sideAName
        )}
      </p>
      <p className={winnerName === sideBName ? "font-medium" : ""}>
        {sideBHref ? (
          <Link href={sideBHref} onClick={(e) => e.stopPropagation()} className="underline decoration-dotted">
            {sideBName}
          </Link>
        ) : (
          sideBName
        )}
      </p>
      {isForfeit && <p className="text-xs text-gray-600 dark:text-neutral-400">Forfeit</p>}
      {sessionSummary && <p className="text-xs text-gray-600 dark:text-neutral-400">{sessionSummary}</p>}
      {expanded && (
        <div className="mt-2 border-t border-gray-200 pt-2 text-xs dark:border-neutral-700">
          {sets.length === 0 && <p>No sets recorded.</p>}
          {sets.map((s) => (
            <p key={s.set_number}>
              Set {s.set_number}: {s.team_a_points}-{s.team_b_points}
            </p>
          ))}
          {adminNote && <p className="mt-1 italic">{adminNote}</p>}
        </div>
      )}
    </div>
  );
}
