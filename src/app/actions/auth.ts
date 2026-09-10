"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAcceptedCurrentTerms } from "@/lib/terms";
import { resolvePostAuthRedirect } from "@/lib/authRedirect";

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

  // This check must come before even the `next` redirect below -- unlike
  // the city prompt (deliberately skippable via a deep link), a legal
  // consent gate must not be bypassable by one. Covers every account that
  // predates this feature too, since they all start with
  // tos_accepted_version IS NULL.
  const { data: termsProfile } = await supabase
    .from("users")
    .select("tos_accepted_version")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!termsProfile || !hasAcceptedCurrentTerms(termsProfile)) {
    redirect(`/accept-terms?next=${encodeURIComponent(next)}`);
  }

  redirect(await resolvePostAuthRedirect(supabase, data.user.id, next));
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const agreedToTerms = formData.get("agreed_to_terms") === "on";

  if (!agreedToTerms) {
    redirect(`/signup?error=${encodeURIComponent("You must agree to the Terms of Service to create an account.")}`);
  }

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
