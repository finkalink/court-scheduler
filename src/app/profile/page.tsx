import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "@/app/actions/profile";
import SkillLevelPicker from "@/components/SkillLevelPicker";
import SuccessBanner from "@/components/SuccessBanner";
import { isProfileComplete } from "@/lib/userProfile";
import { isSafeRedirectPath } from "@/lib/redirects";

const FIELD_LABELS: { key: "name" | "gender" | "skill_level"; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "gender", label: "Gender" },
  { key: "skill_level", label: "Level of play" },
];

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; saved?: string; error?: string }>;
}) {
  const { next: rawNext, message, saved, error } = await searchParams;
  const next = rawNext && isSafeRedirectPath(rawNext) ? rawNext : undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginNext = next ? `/profile?next=${encodeURIComponent(next)}` : "/profile";
    redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("name, gender, skill_level, share_stats_publicly")
    .eq("id", user.id)
    .single();

  const missingFields = profile
    ? FIELD_LABELS.filter((f) => !profile[f.key]).map((f) => f.label)
    : FIELD_LABELS.map((f) => f.label);
  const profileIncomplete = !profile || !isProfileComplete(profile);

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Profile</h1>

      {message && <SuccessBanner>{message}</SuccessBanner>}
      {saved && <SuccessBanner>Profile saved.</SuccessBanner>}
      {error && (
        <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {profileIncomplete && (
        <p className="mt-4 rounded bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
          Still missing: {missingFields.join(", ")}
        </p>
      )}

      <form action={updateProfile} className="mt-6 flex flex-col gap-4">
        {next && <input type="hidden" name="next" value={next} />}
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input name="name" defaultValue={profile?.name ?? ""} className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Gender
          <select
            name="gender"
            defaultValue={profile?.gender ?? ""}
            className="rounded border px-3 py-2 dark:bg-neutral-900"
          >
            <option value="">-- select --</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Level of play
          <SkillLevelPicker defaultValue={profile?.skill_level ?? null} />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="share_stats_publicly"
            defaultChecked={profile?.share_stats_publicly ?? false}
            className="mt-0.5"
          />
          <span>
            Share my stats publicly
            <span className="block text-xs text-gray-600 dark:text-neutral-400">
              Shows your name, skill level, and win/loss record on a public
              page anyone with the link can view. Off by default.
            </span>
          </span>
        </label>
        <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Save
        </button>
      </form>
    </div>
  );
}
