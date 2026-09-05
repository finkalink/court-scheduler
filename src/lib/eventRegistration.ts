export function determineRegistrationStatus(
  currentRegisteredCount: number,
  capacity: number | null
): "registered" | "waitlisted" {
  if (capacity === null) return "registered";
  return currentRegisteredCount < capacity ? "registered" : "waitlisted";
}

export function initialPaymentStatus(feeCents: number | null): "pending" | "not_required" {
  return feeCents !== null && feeCents > 0 ? "pending" : "not_required";
}
