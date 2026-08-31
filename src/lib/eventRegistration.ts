export function determineRegistrationStatus(
  currentRegisteredCount: number,
  capacity: number | null
): "registered" | "waitlisted" {
  if (capacity === null) return "registered";
  return currentRegisteredCount < capacity ? "registered" : "waitlisted";
}
