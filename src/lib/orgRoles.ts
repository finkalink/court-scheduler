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
