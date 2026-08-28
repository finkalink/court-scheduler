import { getTimezone } from "countries-and-timezones";

export type TimezoneOption = {
  id: string;
  city: string;
  subregion: string | null;
  country: string | null;
  search: string;
};

// Common colloquial names players/admins might type instead of an IANA id or
// city name, so "Pacific Time" finds America/Los_Angeles.
const ALIASES: Record<string, string[]> = {
  "America/New_York": ["Eastern Time", "ET"],
  "America/Chicago": ["Central Time", "CT"],
  "America/Denver": ["Mountain Time", "MT"],
  "America/Los_Angeles": ["Pacific Time", "PT"],
  "America/Anchorage": ["Alaska Time"],
  "Pacific/Honolulu": ["Hawaii Time"],
  "America/Halifax": ["Atlantic Time"],
  "Europe/London": ["UK Time", "British Time", "GMT"],
  "Europe/Berlin": ["Central European Time", "CET"],
  "Europe/Athens": ["Eastern European Time", "EET"],
  "Asia/Calcutta": ["India Standard Time", "IST"],
  "Asia/Shanghai": ["China Standard Time"],
  "Asia/Tokyo": ["Japan Standard Time"],
  "Australia/Sydney": ["Australian Eastern Time", "AEST"],
};

const countryDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

function humanize(segment: string): string {
  return segment.replace(/_/g, " ");
}

function countryNameFor(id: string): string | null {
  const code = getTimezone(id)?.countries?.[0];
  if (!code) return null;
  try {
    return countryDisplayNames.of(code) ?? null;
  } catch {
    return null;
  }
}

function buildOption(id: string): TimezoneOption {
  const parts = id.split("/");
  const city = humanize(parts[parts.length - 1]);
  const subregion = parts.length === 3 ? humanize(parts[1]) : null;
  const country = countryNameFor(id);

  const search = [id, city, subregion, country, ...(ALIASES[id] ?? [])]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();

  return { id, city, subregion, country, search };
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = Intl.supportedValuesOf("timeZone")
  .map(buildOption)
  .sort((a, b) => a.city.localeCompare(b.city));

export function formatGmtOffset(id: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: id,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  return raw.replace(/GMT([+-])0?(\d+):/, "GMT$1$2:");
}

export function formatTimezoneLabel(option: TimezoneOption, date?: Date): string {
  const place = [option.city, option.subregion, option.country]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return `${place} (${formatGmtOffset(option.id, date)})`;
}
