"use client";

import { useState } from "react";
import type { GeocodeResult } from "@/app/api/geocode/route";

type Geocode = {
  postalCode: string | null;
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

export default function AddressLookup({
  defaultAddress,
  defaultPostalCode,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  onLocationPicked,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  defaultFormattedAddress: string | null;
  onLocationPicked?: (timezone: string) => void;
}) {
  const [address, setAddress] = useState(defaultAddress);
  const [geocode, setGeocode] = useState<Geocode | null>(
    defaultLatitude != null && defaultLongitude != null
      ? {
          postalCode: defaultPostalCode,
          latitude: defaultLatitude,
          longitude: defaultLongitude,
          formattedAddress: defaultFormattedAddress ?? defaultAddress,
        }
      : null
  );
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function lookup() {
    if (!address.trim()) return;
    setStatus("loading");
    setResults([]);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error("lookup failed");
      const data: GeocodeResult[] = await res.json();
      setResults(data);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function pick(result: GeocodeResult) {
    setAddress(result.simpleAddress);
    setGeocode({
      postalCode: result.postalCode,
      latitude: result.latitude,
      longitude: result.longitude,
      formattedAddress: result.formattedAddress,
    });
    setResults([]);
    if (result.timezone) onLocationPicked?.(result.timezone);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Address
        <div className="flex gap-2">
          <input
            name="address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setGeocode(null);
            }}
            className="flex-1 rounded border px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={lookup}
            disabled={status === "loading"}
            className="shrink-0 rounded border border-gray-400 px-3 py-2 text-sm dark:border-neutral-600 dark:text-neutral-100"
          >
            {status === "loading" ? "Looking up…" : "Look up address"}
          </button>
        </div>
      </label>
      <input type="hidden" name="postal_code" value={geocode?.postalCode ?? ""} />
      <input type="hidden" name="latitude" value={geocode?.latitude ?? ""} />
      <input type="hidden" name="longitude" value={geocode?.longitude ?? ""} />
      <input type="hidden" name="formatted_address" value={geocode?.formattedAddress ?? ""} />

      {status === "error" && (
        <p className="text-xs text-red-700 dark:text-red-400">
          Couldn&apos;t look up that address. Check your connection and try again, or save it as-is.
        </p>
      )}

      {results.length > 0 && (
        <div className="rounded border border-gray-300 p-2 dark:border-neutral-700">
          <ul className="flex flex-col gap-1 text-sm">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="w-full rounded px-2 py-1 text-left hover:bg-gray-50 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500 dark:text-neutral-400">Search by OpenStreetMap</p>
        </div>
      )}

      {geocode ? (
        <p className="text-xs text-green-800 dark:text-green-400">
          Address verified{geocode.postalCode ? ` · ZIP ${geocode.postalCode}` : ""}.
        </p>
      ) : (
        <p className="text-xs text-gray-500 dark:text-neutral-400">
          Not yet verified — look up the address to enable maps links and future weather.
        </p>
      )}
    </div>
  );
}
