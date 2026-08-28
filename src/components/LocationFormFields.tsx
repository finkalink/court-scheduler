"use client";

import { useState } from "react";
import AddressLookup from "@/components/AddressLookup";
import TimezoneSelect from "@/components/TimezoneSelect";

export default function LocationFormFields({
  defaultAddress,
  defaultPostalCode,
  defaultLatitude,
  defaultLongitude,
  defaultFormattedAddress,
  defaultTimezone,
}: {
  defaultAddress: string;
  defaultPostalCode: string | null;
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
