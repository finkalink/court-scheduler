export interface EventSessionSummary {
  start_time: string; // ISO instant
}

// The soonest session that hasn't started yet, or null if every session is
// already in the past (or there are none at all).
export function nextUpcomingSession<T extends EventSessionSummary>(
  sessions: T[],
  now: Date
): T | null {
  const upcoming = sessions.filter((s) => new Date(s.start_time) >= now);
  if (upcoming.length === 0) return null;
  return upcoming.reduce((soonest, s) =>
    new Date(s.start_time) < new Date(soonest.start_time) ? s : soonest
  );
}

// Events with at least one upcoming session, sorted soonest-first. Events
// with no upcoming sessions (fully in the past, or none scheduled) are
// dropped -- matches how the player booking calendar doesn't surface past
// dates by default.
export function sortBySoonestSession<T extends { sessions: EventSessionSummary[] }>(
  events: T[],
  now: Date
): T[] {
  return events
    .map((event) => ({ event, next: nextUpcomingSession(event.sessions, now) }))
    .filter((e): e is { event: T; next: EventSessionSummary } => e.next !== null)
    .sort((a, b) => new Date(a.next.start_time).getTime() - new Date(b.next.start_time).getTime())
    .map((e) => e.event);
}

export interface CityEventGroup<T> {
  city: string;
  events: T[]; // sorted soonest-first
}

export interface GroupedEventsByCity<T> {
  cities: CityEventGroup<T>[]; // sorted by each city's own soonest event
  otherEvents: T[]; // events at locations with no city set, sorted soonest-first
}

// For the events browse page: mirrors groupLocationsByCity's shape, but
// grouping is over events (not distinct clubs) and ordering is
// time-driven (soonest first), not alphabetical.
export function groupEventsByCity<T extends { city: string | null; sessions: EventSessionSummary[] }>(
  events: T[],
  now: Date
): GroupedEventsByCity<T> {
  const upcoming = sortBySoonestSession(events, now);

  const otherEvents: T[] = [];
  const byCity = new Map<string, T[]>();

  for (const event of upcoming) {
    if (!event.city) {
      otherEvents.push(event);
      continue;
    }
    const list = byCity.get(event.city) ?? [];
    list.push(event);
    byCity.set(event.city, list);
  }

  const cities: CityEventGroup<T>[] = Array.from(byCity.entries())
    .map(([city, cityEvents]) => ({ city, events: cityEvents }))
    .sort((a, b) => {
      const aNext = nextUpcomingSession(a.events[0].sessions, now)!;
      const bNext = nextUpcomingSession(b.events[0].sessions, now)!;
      return new Date(aNext.start_time).getTime() - new Date(bNext.start_time).getTime();
    });

  return { cities, otherEvents };
}
