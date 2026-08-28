"use client";

import { useState } from "react";
import AddressLookup from "@/components/AddressLookup";
import TimezoneSelect from "@/components/TimezoneSelect";

export default function LocationFormFields({
  defaultAddress,
  defaultPostalCode,
  defaultCity,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  defaultTimezone,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
  defaultCity: string | null;
  defaultLatitude: number | null;
  defaultLongitude: number | null;
  defaultFormattedAddress: string | null;
  defaultTimezone: string;
}) {
  const [timezone, setTimezone] = useState(defaultTimezone);

  return (
    <>
      <AddressLookup
        defaultAddress={defaultAddress}
        defaultPostalCode={defaultPostalCode}
        defaultCity={defaultCity}
        defaultLatitude={defaultLatitude}
        defaultLongitude={defaultLongitude}
        defaultFormattedAddress={defaultFormattedAddress}
        onLocationPicked={setTimezone}
      />
      <label className="flex flex-col gap-1 text-sm">
        Timezone
        <TimezoneSelect name="timezone" value={timezone} onChange={setTimezone} />
      </label>
    </>
  );
}
