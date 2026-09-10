export const SKILL_LEVELS = ["Recreational", "B", "BB", "A", "AA", "Open"] as const;

export interface DrawRegistrant {
  id: string;
  displayName: string;
  skillLevel: string;
}

export interface DrawnTeam {
  memberIds: string[];
}

// Team count is capped by the target size (ceil), so no team ever exceeds it;
// the remainder is spread one-per-team across the leading teams, so any
// undersized team trails at the end rather than the front.
export function computeTeamSizes(registrantCount: number, targetTeamSize: number): number[] {
  if (registrantCount === 0) return [];
  const teamCount = Math.ceil(registrantCount / targetTeamSize);
  const base = Math.floor(registrantCount / teamCount);
  const remainder = registrantCount % teamCount;
  return Array.from({ length: teamCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

function rank(skillLevel: string): number {
  const i = SKILL_LEVELS.indexOf(skillLevel as (typeof SKILL_LEVELS)[number]);
  return i === -1 ? 0 : i;
}

// Greedy "draft to the team that needs it most": sort registrants strongest
// first, then repeatedly place the next one on the not-yet-full team with the
// lowest running rank sum. Ties (equal sum) go to the earliest such team, so
// results are deterministic for a given input order.
export function drawBalancedTeams(
  registrants: DrawRegistrant[],
  targetTeamSize: number
): DrawnTeam[] {
  const sizes = computeTeamSizes(registrants.length, targetTeamSize);
  const teams = sizes.map(() => ({ memberIds: [] as string[], rankSum: 0 }));

  const sorted = [...registrants].sort((a, b) => rank(b.skillLevel) - rank(a.skillLevel));

  for (const reg of sorted) {
    let bestIndex = -1;
    for (let i = 0; i < teams.length; i++) {
      if (teams[i].memberIds.length >= sizes[i]) continue;
      if (bestIndex === -1 || teams[i].rankSum < teams[bestIndex].rankSum) {
        bestIndex = i;
      }
    }
    teams[bestIndex].memberIds.push(reg.id);
    teams[bestIndex].rankSum += rank(reg.skillLevel);
  }

  return teams.map((t) => ({ memberIds: t.memberIds }));
}
