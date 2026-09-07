"use client";

import { useEffect, useRef } from "react";
import { createBracket } from "bracketry";
import { toBracketryData, type EventMatchSetRow } from "@/lib/bracketryData";
import { isMatchTappable } from "@/lib/activeRounds";
import type { BracketryClickedMatch } from "@/lib/bracketryTypes";
import type { EventMatch } from "@/lib/matchAdvancement";

interface BracketryTreeViewProps {
  matches: EventMatch[];
  sets: EventMatchSetRow[];
  nameByRegistrationId: Map<string, string>;
  activeRound: number;
  interactive: boolean;
  onMatchTap: (match: EventMatch) => void;
}

export default function BracketryTreeView({
  matches,
  sets,
  nameByRegistrationId,
  activeRound,
  interactive,
  onMatchTap,
}: BracketryTreeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReturnType<typeof createBracket> | null>(null);

  // Refs so the click handler set up once at mount always reads the
  // latest props, without needing to recreate (and lose scroll position
  // in) the bracketry instance every time matches/activeRound change.
  const matchesRef = useRef(matches);
  const activeRoundRef = useRef(activeRound);
  const interactiveRef = useRef(interactive);
  const onMatchTapRef = useRef(onMatchTap);

  // Keep the refs mirroring the latest props on every render. This must
  // run as an effect (not directly in the render body) so it stays sound
  // under concurrent rendering, where a discarded/replayed render body
  // must not mutate refs as a side effect. No dependency array -- it's
  // meant to run after every render, same as the old inline assignments.
  useEffect(() => {
    matchesRef.current = matches;
    activeRoundRef.current = activeRound;
    interactiveRef.current = interactive;
    onMatchTapRef.current = onMatchTap;
  });

  useEffect(() => {
    if (!wrapperRef.current) return;
    const data = toBracketryData(matchesRef.current, sets, nameByRegistrationId);
    instanceRef.current = createBracket(data, wrapperRef.current, {
      onMatchClick: (clicked: BracketryClickedMatch) => {
        const match = matchesRef.current.find(
          (m) => m.round_number - 1 === clicked.roundIndex && m.slot_in_round - 1 === clicked.order
        );
        if (!match) return;
        if (interactiveRef.current && !isMatchTappable(match, activeRoundRef.current)) return;
        onMatchTapRef.current(match);
      },
    });
    return () => {
      instanceRef.current?.uninstall();
      instanceRef.current = null;
    };
    // Deliberately empty -- see the refs above for why props changing
    // doesn't need to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!instanceRef.current) return;
    instanceRef.current.replaceData(toBracketryData(matches, sets, nameByRegistrationId));
  }, [matches, sets, nameByRegistrationId]);

  return <div ref={wrapperRef} style={{ height: "480px" }} />;
}
