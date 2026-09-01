import { createClient } from "@/lib/supabase/server";

export default async function PublicPlayerPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_public_player_stats", {
    p_user_id: userId,
  });

  const stats = !error && data && data.length > 0 ? data[0] : null;

  if (!stats) {
    return (
      <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
        <p className="text-sm text-gray-600 dark:text-neutral-400">
          This profile isn&apos;t available.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">{stats.name ?? "Player"}</h1>
      {stats.skill_level && (
        <p className="mt-1 text-sm text-gray-600 dark:text-neutral-400">{stats.skill_level}</p>
      )}
      <p className="mt-4 text-lg">
        {stats.wins}&ndash;{stats.losses}
      </p>
      <p className="text-sm text-gray-600 dark:text-neutral-400">
        {stats.games_played} game{stats.games_played === 1 ? "" : "s"} played
      </p>
    </div>
  );
}
