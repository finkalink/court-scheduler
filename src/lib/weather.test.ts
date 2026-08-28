import { describe, expect, it } from "vitest";
import { filterHoursToWindow, type HourlyForecast } from "@/lib/weather";

describe("filterHoursToWindow", () => {
  // Open-Meteo returns local times (already in the location's timezone,
  // since the API call requests it that way) as "YYYY-MM-DDTHH:MM".
  const hourly: HourlyForecast = {
    time: [
      "2026-09-01T00:00",
      "2026-09-01T08:00",
      "2026-09-01T09:00",
      "2026-09-01T12:00",
      "2026-09-01T16:59",
      "2026-09-01T17:00",
      "2026-09-01T23:00",
    ],
    temperature: [55, 60, 62, 70, 75, 74, 58],
    weatherCode: [0, 1, 2, 3, 61, 0, 0],
    precipitationProbability: [0, 5, 10, 20, 80, 15, 0],
  };

  it("keeps only hours within [openTime, closeTime)", () => {
    const result = filterHoursToWindow(hourly, "09:00:00", "17:00:00");
    expect(result.map((h) => h.time)).toEqual([
      "2026-09-01T09:00",
      "2026-09-01T12:00",
      "2026-09-01T16:59",
    ]);
  });

  it("carries temperature, weather code, and precipitation through per hour", () => {
    const result = filterHoursToWindow(hourly, "09:00:00", "13:00:00");
    expect(result).toEqual([
      { time: "2026-09-01T09:00", temperature: 62, weatherCode: 2, precipitationProbability: 10 },
      { time: "2026-09-01T12:00", temperature: 70, weatherCode: 3, precipitationProbability: 20 },
    ]);
  });

  it("returns an empty list when nothing falls in the window", () => {
    expect(filterHoursToWindow(hourly, "01:00:00", "02:00:00")).toEqual([]);
  });
});
