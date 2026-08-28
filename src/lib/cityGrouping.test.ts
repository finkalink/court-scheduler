import { describe, expect, it } from "vitest";
import { groupLocationsByCity, clubsInCity } from "@/lib/cityGrouping";

describe("groupLocationsByCity", () => {
  it("returns empty groups for no locations", () => {
    expect(groupLocationsByCity([])).toEqual({ cities: [], otherLocations: [] });
  });

  it("counts distinct clubs per city", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-a" },
      { id: "2", city: "New York", orgId: "org-a" }, // same club, same city -- counted once
      { id: "3", city: "New York", orgId: "org-b" },
      { id: "4", city: "Los Angeles", orgId: "org-a" },
    ];
    const result = groupLocationsByCity(locations);
    expect(result.cities).toEqual([
      { city: "Los Angeles", clubCount: 1 },
      { city: "New York", clubCount: 2 },
    ]);
    expect(result.otherLocations).toEqual([]);
  });

  it("sorts cities alphabetically", () => {
    const locations = [
      { id: "1", city: "Zion", orgId: "org-a" },
      { id: "2", city: "Amityville", orgId: "org-b" },
    ];
    const result = groupLocationsByCity(locations);
    expect(result.cities.map((c) => c.city)).toEqual(["Amityville", "Zion"]);
  });

  it("routes locations with no city to otherLocations, excluded from cities", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-a" },
      { id: "2", city: null, orgId: "org-b" },
    ];
    const result = groupLocationsByCity(locations);
    expect(result.cities).toEqual([{ city: "New York", clubCount: 1 }]);
    expect(result.otherLocations).toEqual([{ id: "2", city: null, orgId: "org-b" }]);
  });
});

describe("clubsInCity", () => {
  it("returns only clubs with a location in the given city", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" },
      { id: "2", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" },
      { id: "3", city: "New York", orgId: "org-b", orgName: "Beta Club" },
      { id: "4", city: "Los Angeles", orgId: "org-c", orgName: "Gamma Club" },
    ];
    expect(clubsInCity(locations, "New York")).toEqual([
      { orgId: "org-a", orgName: "Ace Volleyball Club", locationCount: 2 },
      { orgId: "org-b", orgName: "Beta Club", locationCount: 1 },
    ]);
  });

  it("sorts clubs alphabetically by name", () => {
    const locations = [
      { id: "1", city: "New York", orgId: "org-z", orgName: "Zebra Courts" },
      { id: "2", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" },
    ];
    expect(clubsInCity(locations, "New York").map((c) => c.orgName)).toEqual([
      "Ace Volleyball Club",
      "Zebra Courts",
    ]);
  });

  it("returns an empty list for a city with no matching locations", () => {
    const locations = [{ id: "1", city: "New York", orgId: "org-a", orgName: "Ace Volleyball Club" }];
    expect(clubsInCity(locations, "Nowhere")).toEqual([]);
  });

  it("excludes locations with no city", () => {
    const locations = [{ id: "1", city: null, orgId: "org-a", orgName: "Ace Volleyball Club" }];
    expect(clubsInCity(locations, "New York")).toEqual([]);
  });
});
