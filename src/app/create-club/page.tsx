import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isProfileComplete } from "@/lib/userProfile";
import { createOrganization } from "@/app/admin/actions";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Create a Club" };

export default async function CreateClubPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/create-club");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (membership) {
    redirect("/admin");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("name, gender, skill_level")
    .eq("id", user.id)
    .maybeSingle();

  const profileIncomplete = !profile || !isProfileComplete(profile);

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">
        Create a Club<span className="text-accent">.</span>
      </h1>

      {profileIncomplete ? (
        <p className="mt-4 text-sm">
          Complete your profile before creating a club.{" "}
          <Link href={`/profile?next=${encodeURIComponent("/create-club")}`} className="underline">
            Complete your profile
          </Link>
        </p>
      ) : (
        <>
          {error && (
            <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">{error}</p>
          )}
          <form action={createOrganization} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Club name
              <input name="name" required className="rounded border border-border px-3 py-2" />
            </label>
            <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
              Create club
            </button>
          </form>
        </>
      )}
    </div>
  );
}
