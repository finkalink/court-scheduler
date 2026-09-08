import { createClient } from "@/lib/supabase/server";
import { getIsPlatformAdmin } from "@/lib/platformAdmin";
import { updateSiteSetting } from "@/app/site-admin/actions";

export default async function SiteAdminSettingsPage() {
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

  const { data: setting } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "announcement_banner")
    .maybeSingle();

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Settings</h1>

      <form action={updateSiteSetting} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="key" value="announcement_banner" />
        <label className="flex flex-col gap-1 text-sm">
          Announcement banner
          <textarea
            name="value"
            defaultValue={setting?.value ?? ""}
            placeholder="Shown at the top of the home page for everyone. Leave blank to hide it."
            rows={3}
            className="rounded border border-border px-3 py-2 text-sm"
          />
        </label>
        <button type="submit" className="w-fit rounded bg-accent px-4 py-2 text-sm text-accent-fg">
          Save
        </button>
      </form>
    </div>
  );
}
