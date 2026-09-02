"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSafeRedirectPath } from "@/lib/redirects";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const next = String(formData.get("next") || "");

  const supabase = await createClient();
  const { error, data } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`);
  }

  // Links any pending team-roster invites addressed to this exact email
  // to the now-authenticated account (supabase/migrations/0021_team_roster_invites.sql).
  // Can't happen at signUp instead -- no session exists yet at that
  // point in this app's email-confirmation-required flow. Harmless
  // no-op when nothing's pending.
  await supabase.rpc("claim_pending_team_invites");

  if (next && isSafeRedirectPath(next)) {
    redirect(next);
  }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();

  if (membership) {
    redirect("/admin");
  }

  // This check must stay here, after both redirects above -- moving it
  // before the `next` check would hijack every deep-link login into
  // /choose-city instead, and moving it before the membership check would
  // start showing the city prompt to org admins, who should never see it.
  const { data: profile } = await supabase
    .from("users")
    .select("default_city, city_prompt_dismissed")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile && !profile.default_city && !profile.city_prompt_dismissed) {
    redirect("/choose-city");
  }

  redirect("/");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login?message=Check your email to confirm your account, then sign in.");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
