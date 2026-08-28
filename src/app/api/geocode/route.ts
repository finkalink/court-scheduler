import { NextRequest, NextResponse } from "next/server";
import tzLookup from "tz-lookup";

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  postcode?: string;
  country?: string;
};

type NominatimResult = {
  display_name: string;
  lat: string;
  lon: string;
  address?: NominatimAddress;
};

export type GeocodeResult = {
  label: string;
  simpleAddress: string;
  postalCode: string | null;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  timezone: string | null;
};

function buildSimpleAddress(address: NominatimAddress | undefined, fallback: string): string {
  if (!address) return fallback;
  const city = address.city ?? address.town ?? address.village ?? address.hamlet;
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const parts = [street, city, address.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : fallback;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json([]);
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");

  const response = await fetch(url, {
    headers: {
      // Required by Nominatim's usage policy: identify the app, not a browser UA.
      "User-Agent": "court-scheduler (address lookup for facility locations)",
    },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  }

  const results = (await response.json()) as NominatimResult[];

  const geocoded: GeocodeResult[] = results.map((r) => {
    const latitude = Number(r.lat);
    const longitude = Number(r.lon);
    let timezone: string | null = null;
    try {
      timezone = tzLookup(latitude, longitude);
    } catch {
      // Outside tz-lookup's coverage (e.g. open ocean) -- leave it unset.
    }

    return {
      label: r.display_name,
      simpleAddress: buildSimpleAddress(r.address, r.display_name),
      postalCode: r.address?.postcode ?? null,
      latitude,
      longitude,
      formattedAddress: r.display_name,
      timezone,
    };
  });

  return NextResponse.json(geocoded);
}
