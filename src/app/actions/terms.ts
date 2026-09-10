"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSafeRedirectPath } from "@/lib/redirects";
import { CURRENT_TOS_VERSION } from "@/lib/terms";
import { resolvePostAuthRedirect } from "@/lib/authRedirect";

export async function acceptTerms(formData: FormData) {
  const rawNext = String(formData.get("next") || "");
  const next = isSafeRedirectPath(rawNext) ? rawNext : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/accept-terms${next ? `?next=${encodeURIComponent(next)}` : ""}`)}`);
  }

  const { data: updated, error } = await supabase
    .from("users")
    .update({ tos_accepted_version: CURRENT_TOS_VERSION, tos_accepted_at: new Date().toISOString() })
    .eq("id", user.id)
    .select("id");

  // Mirrors the zero-row check this codebase already established for the
  // same failure class (setDefaultCity, updateProfile, cancelEventRegistration).
  if (error || !updated || updated.length === 0) {
    redirect(
      `/accept-terms?next=${encodeURIComponent(next)}&error=${encodeURIComponent("Couldn't save. Try again.")}`
    );
  }

  redirect(await resolvePostAuthRedirect(supabase, user.id, next));
}
