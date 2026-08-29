import { generateSlotStarts } from "@/lib/availability";

export interface SlotBlockState {
  startTime: string; // "HH:MM:SS"
  blocked: boolean;
}

// Builds the admin grid for one day/date's window: every candidate slot
// start, each flagged blocked or not against the already-fetched list of
// blocked start times for that day/date.
export function buildSlotGrid(
  openTime: string,
  closeTime: string,
  stepMinutes: number,
  blockedStartTimes: string[]
): SlotBlockState[] {
  const blockedSet = new Set(blockedStartTimes.map((t) => t.slice(0, 5)));
  return generateSlotStarts(openTime, closeTime, stepMinutes).map((startTime) => ({
    startTime,
    blocked: blockedSet.has(startTime.slice(0, 5)),
  }));
}
