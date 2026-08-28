export interface HourlyForecast {
  time: string[]; // local "YYYY-MM-DDTHH:MM", already in the location's timezone
  temperature: number[]; // fahrenheit
  weatherCode: number[]; // WMO weather interpretation code
  precipitationProbability: number[]; // percent
}

export interface HourlyEntry {
  time: string;
  temperature: number;
  weatherCode: number;
  precipitationProbability: number;
}

function normalizeTime(time: string): string {
  return time.slice(0, 5); // "HH:MM" from "HH:MM" or "HH:MM:SS"
}

function hourOfDay(localIsoTime: string): string {
  return localIsoTime.slice(11, 16); // "HH:MM" from "YYYY-MM-DDTHH:MM"
}

// Trims an already-fetched day's hourly forecast down to just the hours a
// court is actually open, [openTime, closeTime).
export function filterHoursToWindow(
  hourly: HourlyForecast,
  openTime: string,
  closeTime: string
): HourlyEntry[] {
  const open = normalizeTime(openTime);
  const close = normalizeTime(closeTime);

  const result: HourlyEntry[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = hourOfDay(hourly.time[i]);
    if (hour >= open && hour < close) {
      result.push({
        time: hourly.time[i],
        temperature: hourly.temperature[i],
        weatherCode: hourly.weatherCode[i],
        precipitationProbability: hourly.precipitationProbability[i],
      });
    }
  }
  return result;
}

// WMO weather interpretation codes, as used by Open-Meteo.
const WEATHER_CODE_LABELS: Record<number, { emoji: string; label: string }> = {
  0: { emoji: "☀️", label: "Clear" },
  1: { emoji: "🌤️", label: "Mostly Clear" },
  2: { emoji: "⛅", label: "Partly Cloudy" },
  3: { emoji: "☁️", label: "Overcast" },
  45: { emoji: "🌫️", label: "Fog" },
  48: { emoji: "🌫️", label: "Fog" },
  51: { emoji: "🌦️", label: "Drizzle" },
  53: { emoji: "🌦️", label: "Drizzle" },
  55: { emoji: "🌦️", label: "Drizzle" },
  56: { emoji: "🌦️", label: "Freezing Drizzle" },
  57: { emoji: "🌦️", label: "Freezing Drizzle" },
  61: { emoji: "🌧️", label: "Rain" },
  63: { emoji: "🌧️", label: "Rain" },
  65: { emoji: "🌧️", label: "Heavy Rain" },
  66: { emoji: "🌧️", label: "Freezing Rain" },
  67: { emoji: "🌧️", label: "Freezing Rain" },
  71: { emoji: "🌨️", label: "Snow" },
  73: { emoji: "🌨️", label: "Snow" },
  75: { emoji: "🌨️", label: "Heavy Snow" },
  77: { emoji: "🌨️", label: "Snow" },
  80: { emoji: "🌦️", label: "Showers" },
  81: { emoji: "🌦️", label: "Showers" },
  82: { emoji: "🌦️", label: "Heavy Showers" },
  85: { emoji: "🌨️", label: "Snow Showers" },
  86: { emoji: "🌨️", label: "Snow Showers" },
  95: { emoji: "⛈️", label: "Thunderstorm" },
  96: { emoji: "⛈️", label: "Thunderstorm" },
  99: { emoji: "⛈️", label: "Thunderstorm" },
};

export function describeWeatherCode(code: number): { emoji: string; label: string } {
  return WEATHER_CODE_LABELS[code] ?? { emoji: "🌡️", label: "—" };
}

// Fetches one calendar date's hourly forecast for a location. Returns null
// on any failure (network error, non-OK response, or a date outside
// Open-Meteo's forecast range) so callers can just hide the weather widget.
export async function fetchHourlyForecast({
  latitude,
  longitude,
  date,
  timezone,
}: {
  latitude: number;
  longitude: number;
  date: string;
  timezone: string;
}): Promise<HourlyForecast | null> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "temperature_2m,weathercode,precipitation_probability");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);

  let response: Response;
  try {
    response = await fetch(url.toString(), { next: { revalidate: 1800 } });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const data = await response.json();
  const hourly = data?.hourly;
  if (!hourly?.time?.length) return null;

  return {
    time: hourly.time,
    temperature: hourly.temperature_2m,
    weatherCode: hourly.weathercode,
    precipitationProbability: hourly.precipitation_probability,
  };
}
