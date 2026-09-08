import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sortBySoonestSession } from "@/lib/eventGrouping";
import { featuredClubs } from "@/lib/cityGrouping";
import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default async function LandingPage() {
  const supabase = await createClient();

  const [{ data: allEvents }, { data: locations }] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, event_type, location:locations(city), event_sessions(start_time)")
      .neq("status", "draft")
      .neq("status", "cancelled"),
    supabase
      .from("locations")
      .select("id, city, organization:organizations(id, name), courts!inner(id, is_active)")
      .eq("courts.is_active", true),
  ]);

  const mappedEvents = (allEvents ?? []).map((e) => {
    const eventLocation = Array.isArray(e.location) ? e.location[0] : e.location;
    return {
      id: e.id,
      title: e.title,
      eventType: e.event_type,
      city: eventLocation?.city ?? null,
      sessions: e.event_sessions,
    };
  });
  const upcomingEvents = sortBySoonestSession(mappedEvents, new Date()).slice(0, 3);

  const seen = new Set<string>();
  const uniqueLocations = (locations ?? [])
    .filter((l) => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    })
    .map((l) => {
      const org = Array.isArray(l.organization) ? l.organization[0] : l.organization;
      return { id: l.id, city: l.city, orgId: org?.id ?? "", orgName: org?.name ?? "" };
    });
  const clubs = featuredClubs(uniqueLocations, 3);

  return (
    <div>
      <section className="relative overflow-hidden bg-[#1E293B] px-4 py-16 sm:px-6 sm:py-24">
        <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-accent/15" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-link/15" />
        <div className="relative mx-auto max-w-3xl">
          <p className="font-display text-sm uppercase tracking-[0.15em] text-accent">
            Volleyball, your city, your court
          </p>
          <h1 className="font-display mt-4 text-6xl uppercase leading-[0.95] tracking-wide text-white sm:text-7xl">
            Own the
            <br />
            <span className="text-accent">court.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-white/65">
            Book courts, join tournaments, and track every game across the clubs near you.
          </p>
          <form action="/cities" method="get" className="mt-8 flex max-w-md gap-2">
            <input
              type="text"
              name="q"
              placeholder="City of Westminster"
              aria-label="Search cities"
              className="h-12 flex-1 rounded-lg border-0 bg-white/10 px-4 text-sm text-white placeholder:text-white/60 focus:outline-2 focus:outline-accent"
            />
            <button
              type="submit"
              className="h-12 rounded-lg bg-accent px-6 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto grid max-w-3xl grid-cols-3 gap-4 px-4 py-10 sm:px-6">
        {[
          { n: "1", label: "Find a court", body: "Browse clubs near you" },
          { n: "2", label: "Book a slot", body: "Pick a time that works" },
          { n: "3", label: "Play", body: "Show up and compete" },
        ].map((step) => (
          <div key={step.n} className="text-center">
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-status text-sm font-medium text-status-fg">
              {step.n}
            </div>
            <p className="mt-2 text-sm font-medium text-fg">{step.label}</p>
            <p className="text-xs text-fg-muted">{step.body}</p>
          </div>
        ))}
      </section>

      {upcomingEvents.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
          <h2 className="mb-3 text-sm font-medium text-fg">Upcoming events</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {upcomingEvents.map((event, i) => (
              <div key={event.id} className="relative">
                <div
                  className={`absolute inset-0 translate-x-2 translate-y-2 rounded-xl ${
                    i === 0 ? "bg-accent/40" : "bg-fg-muted/30"
                  }`}
                />
                <Link
                  href={`/events/${event.id}`}
                  className="relative block rounded-xl border-2 border-fg bg-card p-5"
                >
                  <p className="mb-2 inline-block rounded-full bg-status px-3 py-0.5 text-xs font-medium text-status-fg">
                    {EVENT_TYPE_LABELS[event.eventType]}
                  </p>
                  <p className="text-lg font-medium text-fg">{event.title}</p>
                  {event.city && <p className="text-sm text-fg-muted">{event.city}</p>}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {clubs.length > 0 && (
        <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <h2 className="mb-3 text-sm font-medium text-fg">Featured clubs</h2>
          <div className="grid grid-cols-3 gap-3">
            {clubs.map((club, i) => (
              <Link
                key={club.orgId}
                href={`/clubs/${club.orgId}`}
                className={`rounded-xl p-4 ${
                  i === 1 ? "bg-accent text-accent-fg" : "bg-[#1E293B] text-white"
                }`}
              >
                <p className="text-sm font-medium">{club.orgName}</p>
                <p className={`text-xs ${i === 1 ? "text-accent-fg" : "text-white/55"}`}>
                  {club.locationCount} location{club.locationCount === 1 ? "" : "s"}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
