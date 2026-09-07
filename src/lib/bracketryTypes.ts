// bracketry's own shipped .d.ts imports types from an internal path
// ("./lib/data/data") that isn't included in the published npm package --
// `import type {...} from "bracketry"` fails to resolve real types (with
// skipLibCheck on, createBracket's own parameters silently become `any`
// instead of erroring). These interfaces are this project's own source of
// truth for the data/options shape bracketry expects, matching its
// documented API at bracketry.app/data-shape and bracketry.app/click-handlers
// -- always construct values shaped to these interfaces, never rely on a
// type import from the package itself.

export interface BracketryRound {
  name?: string;
}

export interface BracketrySetScore {
  mainScore: number;
  isWinner?: boolean;
}

export interface BracketrySide {
  contestantId?: string;
  scores?: BracketrySetScore[];
  isWinner?: boolean;
}

export interface BracketryMatch {
  roundIndex: number;
  order: number;
  sides: BracketrySide[];
}

export interface BracketryContestant {
  players: { title: string }[];
}

export interface BracketryData {
  rounds: BracketryRound[];
  matches: BracketryMatch[];
  contestants: Record<string, BracketryContestant>;
}

// Shape of the object bracketry's onMatchClick callback passes back --
// only the fields we actually read.
export interface BracketryClickedMatch {
  roundIndex: number;
  order: number;
}
