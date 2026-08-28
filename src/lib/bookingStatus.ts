export type BookingTimeStatus = "upcoming" | "in_progress" | "past";

export function categorizeBookingTime(
  startTime: string,
  endTime: string,
  now: Date
): BookingTimeStatus {
  const nowMs = now.getTime();
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  if (nowMs < startMs) return "upcoming";
  if (nowMs < endMs) return "in_progress";
  return "past";
}

export function groupBookingsByTime<T extends { start_time: string; end_time: string }>(
  bookings: T[],
  now: Date
): { upcoming: T[]; inProgress: T[]; past: T[] } {
  const upcoming: T[] = [];
  const inProgress: T[] = [];
  const past: T[] = [];

  for (const booking of bookings) {
    const status = categorizeBookingTime(booking.start_time, booking.end_time, now);
    if (status === "upcoming") upcoming.push(booking);
    else if (status === "in_progress") inProgress.push(booking);
    else past.push(booking);
  }

  const byStartAscending = (a: T, b: T) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  upcoming.sort(byStartAscending);
  inProgress.sort(byStartAscending);
  past.sort((a, b) => -byStartAscending(a, b));

  return { upcoming, inProgress, past };
}

export function isCancellable(status: string, timeStatus: BookingTimeStatus): boolean {
  return status === "confirmed" && timeStatus === "upcoming";
}
