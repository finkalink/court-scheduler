import type { SupabaseClient } from "@supabase/supabase-js";

export async function getIsPlatformAdmin(
  supabase: SupabaseClient,
  userId: string | undefined
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from("users")
    .select("is_platform_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_platform_admin ?? false;
}
