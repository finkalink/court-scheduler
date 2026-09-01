export interface CityGroup {
  city: string;
  clubCount: number;
}

export interface GroupedByCity<T> {
  cities: CityGroup[];
  otherLocations: T[];
}

// For the home page: groups locations into per-city club counts, plus a
// fallback bucket for locations with no city set yet.
export function groupLocationsByCity<T extends { city: string | null; orgId: string }>(
  locations: T[]
): GroupedByCity<T> {
  const otherLocations: T[] = [];
  const clubsByCity = new Map<string, Set<string>>();

  for (const location of locations) {
    if (!location.city) {
      otherLocations.push(location);
      continue;
    }
    const clubs = clubsByCity.get(location.city) ?? new Set<string>();
    clubs.add(location.orgId);
    clubsByCity.set(location.city, clubs);
  }

  const cities: CityGroup[] = Array.from(clubsByCity.entries())
    .map(([city, clubs]) => ({ city, clubCount: clubs.size }))
    .sort((a, b) => a.city.localeCompare(b.city));

  return { cities, otherLocations };
}

export interface ClubInCity {
  orgId: string;
  orgName: string;
  locationCount: number;
}

// For a city page: the distinct clubs with at least one location in the
// given city, sorted alphabetically by name.
export function clubsInCity<T extends { city: string | null; orgId: string; orgName: string }>(
  locations: T[],
  city: string
): ClubInCity[] {
  const countByClub = new Map<string, ClubInCity>();

  for (const location of locations) {
    if (location.city !== city) continue;
    const existing = countByClub.get(location.orgId);
    if (existing) {
      existing.locationCount += 1;
    } else {
      countByClub.set(location.orgId, {
        orgId: location.orgId,
        orgName: location.orgName,
        locationCount: 1,
      });
    }
  }

  return Array.from(countByClub.values()).sort((a, b) => a.orgName.localeCompare(b.orgName));
}

export interface ResolveHomeCityArgs {
  overrideCity: string | null;
  defaultCity: string | null;
  availableCities: string[];
}

// Precedence for what "/" shows: an active session override wins, then the
// player's stored default, then null (meaning "render the full city list").
// A stored value that no longer appears in availableCities (its city's last
// club closed) is treated the same as unset, not an error.
export function resolveHomeCity({
  overrideCity,
  defaultCity,
  availableCities,
}: ResolveHomeCityArgs): string | null {
  if (overrideCity && availableCities.includes(overrideCity)) return overrideCity;
  if (defaultCity && availableCities.includes(defaultCity)) return defaultCity;
  return null;
}

// Shared validator for every write path that accepts a city from a form
// (setDefaultCity, setCityOverride, updateProfile's default_city field) --
// rejects a raw POST supplying a value never offered in that path's own
// <select>, including one that was valid when the page rendered but whose
// last club has since closed.
export function isKnownCity(city: string, availableCities: string[]): boolean {
  return availableCities.includes(city);
}
