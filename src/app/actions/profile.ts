"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// A safe redirect target must be a same-origin relative path: starts with a
// single "/" and not "//" or "/\" (both of which browsers can treat as
// protocol-relative, i.e. off-site).
function isSafeRedirectPath(path: string): boolean {
  return /^\/(?!\/|\\)/.test(path);
}

export async function updateProfile(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const skillLevel = String(formData.get("skill_level") || "").trim();
  const rawNext = String(formData.get("next") || "");
  const next = isSafeRedirectPath(rawNext) ? rawNext : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const { error } = await supabase
    .from("users")
    .update({
      name: name || null,
      gender: gender || null,
      skill_level: skillLevel || null,
    })
    .eq("id", user.id);

  if (error) {
    redirect(`/profile?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/profile");

  if (next) {
    redirect(`${next}?message=${encodeURIComponent("Profile saved.")}`);
  }

  redirect("/profile?saved=1");
}
