"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

export async function createOrganizationForUser(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const email = String(formData.get("owner_email") || "").trim().toLowerCase();

  if (!name || !email) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent("Club name and owner email are both required.")}`);
  }

  const supabase = await createClient();

  const { data: owner, error: lookupError } = await supabase
    .from("users")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (lookupError) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent("Couldn't look up that email. Try again.")}`);
  }

  if (!owner) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent(`No user found with email "${email}".`)}`);
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, is_active: true })
    .select("id")
    .single();

  if (orgError || !org) {
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent(orgError?.message ?? "Couldn't create the club.")}`);
  }

  const { error: memberError } = await supabase
    .from("org_members")
    .insert({ org_id: org.id, user_id: owner!.id, role: "owner" });

  if (memberError) {
    // Unlike createOrganization's self-serve path, this cleanup works:
    // the caller here is a platform admin, whose session has DELETE on
    // organizations via their own blanket ALL policy.
    await supabase.from("organizations").delete().eq("id", org.id);
    redirect(`/site-admin/orgs/new?error=${encodeURIComponent("Couldn't finish setting up the club. Try again.")}`);
  }

  revalidatePath("/site-admin/orgs");
  redirect("/site-admin/orgs?club_created=1");
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
