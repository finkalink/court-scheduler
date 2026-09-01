import type { SupabaseClient } from "@supabase/supabase-js";

// Name of the session cookie that overrides a signed-in user's stored
// default_city (or stands alone for a signed-out visitor) for the rest of
// the browser session. Shared between the Server Actions that write it
// (src/app/actions/cityPreference.ts) and the home page that reads it
// (src/app/page.tsx) so the name can't drift between the two.
export const CITY_OVERRIDE_COOKIE = "city_override";

// Distinct cities with at least one active-court location, alphabetical --
// the same "which cities can a player pick" set used by the home page's
// personalization fallback, /choose-city, /profile's default-city field,
// and every write path's validation (isKnownCity, src/lib/cityGrouping.ts).
export async function listActiveCities(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("locations")
    .select("city, courts!inner(id, is_active)")
    .eq("courts.is_active", true);

  const cities = new Set<string>();
  for (const row of data ?? []) {
    if (row.city) cities.add(row.city);
  }
  return Array.from(cities).sort((a, b) => a.localeCompare(b));
}
