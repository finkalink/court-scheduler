export interface ProfileFields {
  name: string | null;
  gender: string | null;
  skill_level: string | null;
}

export function isProfileComplete(profile: ProfileFields): boolean {
  return Boolean(profile.name) && Boolean(profile.gender) && Boolean(profile.skill_level);
}
