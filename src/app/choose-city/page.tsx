import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities } from "@/lib/cities";
import { setDefaultCity, skipCityPrompt } from "@/app/actions/cityPreference";

export default async function ChooseCityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/choose-city");
  }

  const cities = await listActiveCities(supabase);

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Pick Your Home City</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-neutral-400">
        We&apos;ll show you clubs in this city by default when you visit Find a Court. You can
        change this anytime from your profile.
      </p>

      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {cities.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">No cities available yet.</p>
      ) : (
        <form action={setDefaultCity} className="mt-6 flex flex-col gap-3">
          <select
            name="city"
            defaultValue=""
            required
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="" disabled>
              -- select a city --
            </option>
            {cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
          <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
            Set my city
          </button>
        </form>
      )}

      <form action={skipCityPrompt} className="mt-3">
        <button type="submit" className="text-sm underline">
          Skip for now
        </button>
      </form>
    </div>
  );
}
