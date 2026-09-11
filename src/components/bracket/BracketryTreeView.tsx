"use client";

import { useEffect, useRef } from "react";
import { createBracket } from "bracketry";
import { toBracketryData, type EventMatchSetRow } from "@/lib/bracketryData";
import { isMatchTappable } from "@/lib/activeRounds";
import type { BracketryClickedMatch, BracketryThemeOptions } from "@/lib/bracketryTypes";
import type { EventMatch } from "@/lib/matchAdvancement";

// Every value is a CSS custom-property reference rather than a resolved
// color/font -- bracketry writes these straight into inline styles, and a
// var() reference re-resolves on every paint, so the bracket picks up a
// light/dark theme toggle for free with no re-render or recreation needed.
// Left unset here (falling back to bracketry's own hard-coded defaults, e.g.
// matchStatusBgColor "#fff"), a match card stayed white-on-black regardless
// of the site's theme -- the actual cause of the bracket looking out of
// place against the rest of the app.
const BRACKETRY_THEME: BracketryThemeOptions = {
  rootBgColor: "transparent",
  rootBorderColor: "var(--border)",
  matchStatusBgColor: "var(--card)",
  matchTextColor: "var(--fg)",
  roundTitleColor: "var(--fg-muted)",
  connectionLinesColor: "var(--border)",
  highlightedConnectionLinesColor: "var(--accent)",
  highlightedPlayerTitleColor: "var(--accent)",
  liveMatchBgColor: "var(--active)",
  liveMatchBorderColor: "var(--accent)",
  hoveredMatchBorderColor: "var(--accent)",
  navButtonSvgColor: "var(--fg-muted)",
  scrollButtonSvgColor: "var(--fg-muted)",
  scrollbarColor: "var(--border)",
  rootFontFamily: "var(--font-sans)",
  roundTitlesFontFamily: "var(--font-display)",
};

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
      ...BRACKETRY_THEME,
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

  // No border/background classes here -- bracketry's own .bracket-root
  // element already paints both (rootBgColor/rootBorderColor above), so
  // adding a second set on this wrapper would just double the border.
  return <div ref={wrapperRef} style={{ height: "480px" }} />;
}
