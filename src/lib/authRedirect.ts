import type { SupabaseClient } from "@supabase/supabase-js";
import { isSafeRedirectPath } from "@/lib/redirects";
import { getCurrentMembership } from "@/lib/orgMembership";

// Shared by signIn and /accept-terms's action, so both agree on where a
// freshly-authenticated (and, as of the ToS gate, freshly-accepted) user
// actually belongs -- next, then org membership, then the one-time city
// prompt, then home. Order matters: next must win over the city prompt (a
// deep link shouldn't be hijacked), and membership must be checked before
// the city prompt (an org admin should never see it).
export async function resolvePostAuthRedirect(
  supabase: SupabaseClient,
  userId: string,
  next: string
): Promise<string> {
  if (next && isSafeRedirectPath(next)) {
    return next;
  }

  const membership = await getCurrentMembership(supabase, userId);
  if (membership) {
    return "/admin";
  }

  const { data: profile } = await supabase
    .from("users")
    .select("default_city, city_prompt_dismissed")
    .eq("id", userId)
    .maybeSingle();

  if (profile && !profile.default_city && !profile.city_prompt_dismissed) {
    return "/choose-city";
  }

  return "/";
}
