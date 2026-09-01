"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { listActiveCities, CITY_OVERRIDE_COOKIE } from "@/lib/cities";
import { isKnownCity } from "@/lib/cityGrouping";

// Called from /choose-city (the one-time first-login prompt). Sets the
// player's stored default and lands them on that city's page.
export async function setDefaultCity(formData: FormData) {
  const city = String(formData.get("city") || "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/choose-city");
  }

  const availableCities = await listActiveCities(supabase);
  if (!city || !isKnownCity(city, availableCities)) {
    redirect(`/choose-city?error=${encodeURIComponent("Pick a valid city.")}`);
  }

  await supabase.from("users").update({ default_city: city }).eq("id", user.id);

  redirect(`/cities/${encodeURIComponent(city)}`);
}

// Called from /choose-city's "Skip for now". Permanent -- the prompt never
// reappears on a later login once this is set, per the approved design.
export async function skipCityPrompt() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/choose-city");
  }

  await supabase.from("users").update({ city_prompt_dismissed: true }).eq("id", user.id);

  redirect("/");
}

// Called by clicking a city on the full /cities list (AllCitiesContent).
// Works for signed-out visitors too -- it's a plain session cookie, not an
// account edit, so no auth check is needed here.
export async function setCityOverride(formData: FormData) {
  const city = String(formData.get("city") || "").trim();

  const supabase = await createClient();
  const availableCities = await listActiveCities(supabase);
  if (!city || !isKnownCity(city, availableCities)) {
    redirect("/cities");
  }

  const cookieStore = await cookies();
  cookieStore.set(CITY_OVERRIDE_COOKIE, city, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  redirect(`/cities/${encodeURIComponent(city)}`);
}

// Called from "/"'s "Reset to my city" / "Clear" link. Only ever removes
// the session override -- never touches the stored default_city.
export async function clearCityOverride() {
  const cookieStore = await cookies();
  cookieStore.delete(CITY_OVERRIDE_COOKIE);
  redirect("/");
}
