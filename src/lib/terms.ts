// Independent of the document's own "Last updated" line -- bumping this is
// always an explicit code change, never inferred by parsing the markdown.
// Bumping it re-prompts every account on its next sign-in.
export const CURRENT_TOS_VERSION = "2026-09-09";

export function hasAcceptedCurrentTerms(user: { tos_accepted_version: string | null }): boolean {
  return user.tos_accepted_version === CURRENT_TOS_VERSION;
}
