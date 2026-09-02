import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities, CITY_OVERRIDE_COOKIE } from "@/lib/cities";
import { resolveHomeCity } from "@/lib/cityGrouping";
import { clearCityOverride } from "@/app/actions/cityPreference";
import CityContent from "@/components/CityContent";
import AllCitiesContent from "@/components/AllCitiesContent";

export default async function Home() {
  const supabase = await createClient();
  const cookieStore = await cookies();
  const overrideCity = cookieStore.get(CITY_OVERRIDE_COOKIE)?.value ?? null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let defaultCity: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("default_city")
      .eq("id", user.id)
      .maybeSingle();
    defaultCity = profile?.default_city ?? null;
  }

  const availableCities = await listActiveCities(supabase);
  const resolvedCity = resolveHomeCity({ overrideCity, defaultCity, availableCities });

  if (!resolvedCity) {
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
        <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>
        <AllCitiesContent />
      </div>
    );
  }

  const overrideDiffersFromDefault = overrideCity === resolvedCity && overrideCity !== defaultCity;

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Find a Court</h1>

      <div className="mt-2 flex items-center justify-between text-sm text-gray-600 dark:text-neutral-400">
        <span>Browsing: {resolvedCity}</span>
        <span className="flex items-center gap-3">
          <Link href="/cities" className="underline">
            See all cities
          </Link>
          {overrideDiffersFromDefault && (
            <form action={clearCityOverride}>
              <button type="submit" className="underline">
                {defaultCity ? "Reset to my city" : "Clear"}
              </button>
            </form>
          )}
        </span>
      </div>

      <CityContent city={resolvedCity} />
    </div>
  );
}
