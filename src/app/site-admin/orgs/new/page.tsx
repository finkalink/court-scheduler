import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { createOrganizationForUser } from "@/app/site-admin/actions";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Add Organization" };

export default async function NewOrgPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPlatformAdmin = await getIsPlatformAdmin(supabase, user?.id);

  if (!isPlatformAdmin) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-fg-muted">
        You don&apos;t have access to site admin.
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Add Organization</h1>

      {error && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">{error}</p>
      )}

      <form action={createOrganizationForUser} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Club name
          <input name="name" required className="rounded border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Owner&apos;s email
          <input
            name="owner_email"
            type="email"
            required
            className="rounded border border-border px-3 py-2"
          />
          <span className="text-xs text-fg-muted">Must be an existing user&apos;s account email.</span>
        </label>
        <button type="submit" className={`w-fit ${buttonClass("primary")}`}>
          Create organization
        </button>
      </form>
    </div>
  );
}
