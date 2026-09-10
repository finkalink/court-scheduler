export type SocialPlatform = "instagram" | "facebook" | "twitter";

const URL_DOMAINS: Record<SocialPlatform, string[]> = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com"],
  // X still redirects from twitter.com -- accept a paste of either.
  twitter: ["twitter.com", "x.com"],
};

const DISPLAY_DOMAIN: Record<SocialPlatform, string> = {
  instagram: "instagram.com",
  facebook: "facebook.com",
  twitter: "x.com",
};

export function parseSocialHandle(platform: SocialPlatform, input: string): string {
  let value = input.trim();
  if (!value) return "";

  for (const domain of URL_DOMAINS[platform]) {
    const match = value.match(
      new RegExp(`^(https?://)?(www\\.)?${domain.replace(".", "\\.")}/`, "i")
    );
    if (match) {
      value = value.slice(match[0].length);
      break;
    }
  }

  value = value.replace(/^@/, "").replace(/\/+$/, "");
  return value;
}

export function buildSocialUrl(platform: SocialPlatform, handle: string): string {
  return `https://${DISPLAY_DOMAIN[platform]}/${handle}`;
}
