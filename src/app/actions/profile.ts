"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSafeRedirectPath } from "@/lib/redirects";

const VALID_GENDERS = new Set(["male", "female", "prefer_not_to_say"]);
const VALID_SKILL_LEVELS = new Set(["Recreational", "B", "BB", "A", "AA", "Open"]);

export async function updateProfile(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const skillLevel = String(formData.get("skill_level") || "").trim();
  const shareStatsPublicly = formData.get("share_stats_publicly") === "on";
  const rawNext = String(formData.get("next") || "");
  const next = isSafeRedirectPath(rawNext) ? rawNext : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  // Client-side <select>s already constrain these, but nothing stops a raw
  // POST from supplying an out-of-set value -- reject before ever touching
  // the database rather than relying on the DB check constraint to fail.
  if ((gender && !VALID_GENDERS.has(gender)) || (skillLevel && !VALID_SKILL_LEVELS.has(skillLevel))) {
    redirect(`/profile?error=${encodeURIComponent("Invalid profile value.")}`);
  }

  const { data: updated, error } = await supabase
    .from("users")
    .update({
      name: name || null,
      gender: gender || null,
      skill_level: skillLevel || null,
      share_stats_publicly: shareStatsPublicly,
    })
    .eq("id", user.id)
    .select("id");

  if (error) {
    redirect(`/profile?error=${encodeURIComponent("Couldn't save your profile. Try again.")}`);
  }

  // Mirrors the zero-row check in cancelEventRegistration
  // (src/app/actions/events.ts) -- an update matching no row (e.g. no
  // users row exists for this account, which shouldn't happen given the
  // signup trigger but isn't guaranteed) returns no error, so it must be
  // checked separately to avoid a false "saved" redirect.
  if (!updated || updated.length === 0) {
    redirect(
      `/profile?error=${encodeURIComponent("Couldn't find your account. Try signing in again.")}`
    );
  }

  revalidatePath("/profile");

  if (next) {
    const separator = next.includes("?") ? "&" : "?";
    redirect(`${next}${separator}message=${encodeURIComponent("Profile saved.")}`);
  }

  redirect("/profile?saved=1");
}
