export type OrgRole = "owner" | "admin" | "staff";

export function isOwnerOrAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

// Guards against an org ending up with zero owners. Called before removing
// a member or changing their role away from "owner" -- both operations take
// the member from "owner" to "not owner", so the check only needs the
// member's role *before* the change and how many owners the org currently
// has, not which specific operation is happening.
export function wouldRemoveLastOwner(ownerCount: number, targetCurrentRole: OrgRole): boolean {
  return targetCurrentRole === "owner" && ownerCount <= 1;
}

// Only an owner may change or remove another owner's access -- any
// non-owner admin is otherwise able to demote/remove *any* member,
// including an owner, since org membership management is gated on
// "owner or admin" generally. wouldRemoveLastOwner alone doesn't cover
// this: it only blocks touching the org's *last* owner, not an owner
// specifically being acted on by a non-owner.
export function canActOnMember(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return targetRole !== "owner" || actorRole === "owner";
}
