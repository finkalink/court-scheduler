import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import Avatar from "@/components/Avatar";
import { buildSocialUrl } from "@/lib/socialLinks";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>;
}): Promise<Metadata> {
  const { userId } = await params;
  const supabase = await createClient();
  const { data: player } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle();
  return { title: player?.name ?? "Player" };
}

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
        <p className="text-sm text-fg-muted">
          This profile isn&apos;t available.
        </p>
      </div>
    );
  }

  const socialLinks = [
    stats.instagram_handle && { label: "Instagram", href: buildSocialUrl("instagram", stats.instagram_handle) },
    stats.facebook_handle && { label: "Facebook", href: buildSocialUrl("facebook", stats.facebook_handle) },
    stats.twitter_handle && { label: "X", href: buildSocialUrl("twitter", stats.twitter_handle) },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  return (
    <div className="mx-auto mt-6 max-w-sm px-4 sm:mt-10 sm:px-0">
      <div className="flex items-center gap-4">
        <Avatar url={stats.avatar_url} size="md" alt={stats.name ?? "Player"} />
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{stats.name ?? "Player"}</h1>
          {stats.skill_level && (
            <p className="mt-1 text-sm text-fg-muted">{stats.skill_level}</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-lg">
        {stats.wins}&ndash;{stats.losses}
      </p>
      <p className="text-sm text-fg-muted">
        {stats.games_played} game{stats.games_played === 1 ? "" : "s"} played
      </p>
      {socialLinks.length > 0 && (
        <div className="mt-4 flex gap-4">
          {socialLinks.map((link) => (
            <a key={link.label} href={link.href} className="text-sm text-link underline" target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
