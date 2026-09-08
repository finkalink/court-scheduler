"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleOrgActive(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const nextActive = formData.get("next_active") === "true";
  const supabase = await createClient();
  await supabase.from("organizations").update({ is_active: nextActive }).eq("id", orgId);
  revalidatePath("/site-admin/orgs");
}

export async function toggleUserActive(formData: FormData) {
  const userId = String(formData.get("user_id"));
  const nextActive = formData.get("next_active") === "true";
  const supabase = await createClient();
  await supabase.from("users").update({ is_active: nextActive }).eq("id", userId);
  revalidatePath("/site-admin/users");
}

export async function togglePlatformAdmin(formData: FormData) {
  const userId = String(formData.get("user_id"));
  const nextValue = formData.get("next_value") === "true";
  const supabase = await createClient();
  await supabase.from("users").update({ is_platform_admin: nextValue }).eq("id", userId);
  revalidatePath("/site-admin/users");
}

export async function updateAnyOrgMemberRole(formData: FormData) {
  const orgId = String(formData.get("org_id"));
  const userId = String(formData.get("user_id"));
  const roleInput = String(formData.get("role") || "");
  const role = roleInput === "admin" || roleInput === "staff" ? roleInput : "staff";
  const supabase = await createClient();
  await supabase.from("org_members").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  revalidatePath("/site-admin/users");
}

export async function updateSiteSetting(formData: FormData) {
  const key = String(formData.get("key"));
  const value = String(formData.get("value") ?? "");
  const supabase = await createClient();
  await supabase
    .from("site_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  revalidatePath("/site-admin/settings");
  revalidatePath("/");
}
