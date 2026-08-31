import { describe, expect, it } from "vitest";
import { nextUpcomingSession, sortBySoonestSession, groupEventsByCity } from "@/lib/eventGrouping";

const NOW = new Date("2026-09-01T00:00:00Z");

describe("nextUpcomingSession", () => {
  it("returns null for no sessions", () => {
    expect(nextUpcomingSession([], NOW)).toBeNull();
  });

  it("returns null when every session is in the past", () => {
    const sessions = [{ start_time: "2026-08-01T00:00:00Z" }];
    expect(nextUpcomingSession(sessions, NOW)).toBeNull();
  });

  it("picks the earliest of several upcoming sessions", () => {
    const sessions = [
      { start_time: "2026-09-10T00:00:00Z" },
      { start_time: "2026-09-05T00:00:00Z" },
      { start_time: "2026-09-20T00:00:00Z" },
    ];
    expect(nextUpcomingSession(sessions, NOW)).toEqual({ start_time: "2026-09-05T00:00:00Z" });
  });

  it("ignores past sessions mixed in with future ones", () => {
    const sessions = [
      { start_time: "2026-08-01T00:00:00Z" },
      { start_time: "2026-09-15T00:00:00Z" },
    ];
    expect(nextUpcomingSession(sessions, NOW)).toEqual({ start_time: "2026-09-15T00:00:00Z" });
  });
});

describe("sortBySoonestSession", () => {
  it("drops events with no upcoming sessions", () => {
    const events = [
      { id: "past", sessions: [{ start_time: "2026-01-01T00:00:00Z" }] },
      { id: "future", sessions: [{ start_time: "2026-09-10T00:00:00Z" }] },
    ];
    expect(sortBySoonestSession(events, NOW).map((e) => e.id)).toEqual(["future"]);
  });

  it("sorts remaining events by their soonest session", () => {
    const events = [
      { id: "later", sessions: [{ start_time: "2026-10-01T00:00:00Z" }] },
      { id: "sooner", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
    ];
    expect(sortBySoonestSession(events, NOW).map((e) => e.id)).toEqual(["sooner", "later"]);
  });
});

describe("groupEventsByCity", () => {
  it("returns empty groups for no events", () => {
    expect(groupEventsByCity([], NOW)).toEqual({ cities: [], otherEvents: [] });
  });

  it("buckets events by city, sorted soonest-first within a city", () => {
    const events = [
      { id: "ny-later", city: "New York", sessions: [{ start_time: "2026-10-01T00:00:00Z" }] },
      { id: "ny-sooner", city: "New York", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
      { id: "la-only", city: "Los Angeles", sessions: [{ start_time: "2026-09-15T00:00:00Z" }] },
    ];
    const result = groupEventsByCity(events, NOW);
    const ny = result.cities.find((c) => c.city === "New York");
    expect(ny?.events.map((e) => e.id)).toEqual(["ny-sooner", "ny-later"]);
  });

  it("sorts cities by their own soonest event", () => {
    const events = [
      { id: "ny", city: "New York", sessions: [{ start_time: "2026-10-01T00:00:00Z" }] },
      { id: "la", city: "Los Angeles", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
    ];
    const result = groupEventsByCity(events, NOW);
    expect(result.cities.map((c) => c.city)).toEqual(["Los Angeles", "New York"]);
  });

  it("routes events with no city to otherEvents, excluded from cities", () => {
    const events = [
      { id: "has-city", city: "New York", sessions: [{ start_time: "2026-09-05T00:00:00Z" }] },
      { id: "no-city", city: null, sessions: [{ start_time: "2026-09-10T00:00:00Z" }] },
    ];
    const result = groupEventsByCity(events, NOW);
    expect(result.cities.map((c) => c.city)).toEqual(["New York"]);
    expect(result.otherEvents.map((e) => e.id)).toEqual(["no-city"]);
  });

  it("drops events with no upcoming sessions entirely, even from otherEvents", () => {
    const events = [{ id: "past", city: null, sessions: [{ start_time: "2026-01-01T00:00:00Z" }] }];
    const result = groupEventsByCity(events, NOW);
    expect(result.cities).toEqual([]);
    expect(result.otherEvents).toEqual([]);
  });
});
