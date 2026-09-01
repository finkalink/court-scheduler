# User Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up a real player profile (name, gender, level of play),
and require it to be complete before registering for anything other than
an `open_play` event.

**Architecture:** Two new columns on the already-existing (but never
written to) `users` table, a new `/profile` page as the sole place to set
them, a pure `isProfileComplete` check reused by both the profile page's
own display and a new gate inside `registerForEvent`, and a small
client-side skill-level picker that lets a player choose either the
letter-rating scale or a plain-language scale that maps onto it.

**Tech Stack:** Next.js server components/actions, Supabase Postgres +
RLS, Vitest for the one pure-logic module.

**Spec:** `docs/superpowers/specs/2026-09-01-user-profiles-design.md`
— note the "Profile page (not at signup)" section: signup deliberately
stays email/password only (see that section for why collecting these
fields at signup time isn't safe in this app).

## Global Constraints

- No RLS changes — `users select own`/`users update own` (`id =
  auth.uid()`) already cover everything here.
- Gender and skill level aren't read or displayed by any other feature
  in this plan — captured for future use only, visible to the profile's
  own owner.
- No retroactive enforcement — the registration gate applies only to new
  registration attempts; existing registrations are unaffected.
- `event_registrations.display_name`/`event_team_members.display_name`
  are unchanged as fields — this plan only pre-fills them from
  `users.name`, never removes the override.
- A blank name on `/profile`'s save is stored as `null`, never an empty
  string, so `isProfileComplete` only ever checks for `null`/missing.

---

### Task 1: Migration — `gender`, `skill_level` columns

**Files:**
- Create: `supabase/migrations/0022_user_profiles.sql`

**Interfaces:**
- Produces: `users.gender`, `users.skill_level` columns (consumed by
  Tasks 2-5).

- [ ] **Step 1: Write the migration**

```sql
-- User profiles. users.name already existed (0001_init.sql) but was
-- never written to by any code path. Adds gender and skill_level so a
-- real profile exists to gate non-open_play event registration on (see
-- registerForEvent in src/app/actions/events.ts) and to serve as a
-- default display name. No RLS changes needed -- "users select own"/
-- "users update own" (0002_rls.sql) already cover a player reading and
-- editing their own profile row.

alter table users add column gender text
  check (gender in ('male', 'female', 'prefer_not_to_say'));
alter table users add column skill_level text
  check (skill_level in ('Recreational', 'B', 'BB', 'A', 'AA', 'Open'));
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate -- supabase/migrations/0022_user_profiles.sql`

- [ ] **Step 3: Verify against the live database**

Confirm both columns exist and their check constraints reject an invalid
value (e.g. `gender = 'x'`, `skill_level = 'C'`) and accept every listed
option. As a real test account (e.g. `test.player@courtscheduler.dev`),
confirm they can update their own `name`/`gender`/`skill_level` via a
direct query using their own session, and that `users select own`/`users
update own` behave the same as before for every other existing column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0022_user_profiles.sql
git commit -m "Add gender and skill_level columns to users"
```

---

### Task 2: Pure logic — profile completeness

**Files:**
- Create: `src/lib/userProfile.ts`
- Create: `src/lib/userProfile.test.ts`

**Interfaces:**
- Produces: `ProfileFields` type, `isProfileComplete(profile:
  ProfileFields): boolean` (consumed by Tasks 3-4).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/userProfile.test.ts
import { describe, expect, it } from "vitest";
import { isProfileComplete } from "@/lib/userProfile";

describe("isProfileComplete", () => {
  it("is true when all three fields are set", () => {
    expect(isProfileComplete({ name: "Alex", gender: "female", skill_level: "BB" })).toBe(true);
  });

  it("is false when name is missing", () => {
    expect(isProfileComplete({ name: null, gender: "female", skill_level: "BB" })).toBe(false);
  });

  it("is false when gender is missing", () => {
    expect(isProfileComplete({ name: "Alex", gender: null, skill_level: "BB" })).toBe(false);
  });

  it("is false when skill_level is missing", () => {
    expect(isProfileComplete({ name: "Alex", gender: "female", skill_level: null })).toBe(false);
  });

  it("treats an empty string the same as missing", () => {
    expect(isProfileComplete({ name: "", gender: "female", skill_level: "BB" })).toBe(false);
  });

  it("is false when everything is missing", () => {
    expect(isProfileComplete({ name: null, gender: null, skill_level: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- userProfile`
Expected: FAIL with "Cannot find module '@/lib/userProfile'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/userProfile.ts
export interface ProfileFields {
  name: string | null;
  gender: string | null;
  skill_level: string | null;
}

export function isProfileComplete(profile: ProfileFields): boolean {
  return Boolean(profile.name) && Boolean(profile.gender) && Boolean(profile.skill_level);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- userProfile`
Expected: PASS, all cases green

- [ ] **Step 5: Commit**

```bash
git add src/lib/userProfile.ts src/lib/userProfile.test.ts
git commit -m "Add profile-completeness check, test-first"
```

---

### Task 3: Profile page

**Files:**
- Create: `src/components/SkillLevelPicker.tsx`
- Create: `src/app/actions/profile.ts`
- Create: `src/app/profile/page.tsx`
- Modify: `src/components/AppShell.tsx`

**Interfaces:**
- Produces: `SkillLevelPicker` component (props: `defaultValue: string |
  null`, renders a hidden `<input name="skill_level">`); `updateProfile
  (formData)` action (consumed by the page itself and, indirectly, by
  Task 4's redirect target).

- [ ] **Step 1: Write the skill-level picker component**

```tsx
// src/components/SkillLevelPicker.tsx
"use client";

import { useState } from "react";

const LETTER_OPTIONS: { value: string; description: string }[] = [
  { value: "Recreational", description: "Just here to have fun and stay active -- new to volleyball or plays casually" },
  { value: "B", description: "Knows the basic rules and skills, still building consistency" },
  { value: "BB", description: "Comfortable with fundamentals, plays in casual competitive leagues" },
  { value: "A", description: "Strong all-around player with consistent skills" },
  { value: "AA", description: "Highly skilled, plays regularly at a competitive level" },
  { value: "Open", description: "Elite / collegiate-or-above competitive player" },
];

// Only the letter value is ever stored. Recreational is shared between
// both pickers (stores directly, no mapping needed); AA is reachable
// only via the letter picker -- the plain-language scale is
// deliberately coarser.
const PLAIN_TO_LETTER: Record<string, string> = {
  Recreational: "Recreational",
  Beginner: "B",
  Intermediate: "BB",
  Advanced: "A",
  Competitive: "Open",
};

export default function SkillLevelPicker({ defaultValue }: { defaultValue: string | null }) {
  const [useLetters, setUseLetters] = useState(true);
  const [value, setValue] = useState(defaultValue ?? "");

  const plainValue = Object.entries(PLAIN_TO_LETTER).find(([, letter]) => letter === value)?.[0] ?? "";

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="skill_level" value={value} />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={!useLetters}
          onChange={(e) => setUseLetters(!e.target.checked)}
        />
        I&apos;m not familiar with volleyball skill ratings
      </label>

      {useLetters ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded border px-3 py-2 text-sm dark:bg-neutral-900"
        >
          <option value="">-- select --</option>
          {LETTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value} -- {o.description}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={plainValue}
          onChange={(e) => setValue(PLAIN_TO_LETTER[e.target.value] ?? "")}
          className="rounded border px-3 py-2 text-sm dark:bg-neutral-900"
        >
          <option value="">-- select --</option>
          {Object.keys(PLAIN_TO_LETTER).map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the `updateProfile` action**

```ts
// src/app/actions/profile.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updateProfile(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const gender = String(formData.get("gender") || "").trim();
  const skillLevel = String(formData.get("skill_level") || "").trim();
  const next = String(formData.get("next") || "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  const { error } = await supabase
    .from("users")
    .update({
      name: name || null,
      gender: gender || null,
      skill_level: skillLevel || null,
    })
    .eq("id", user.id);

  if (error) {
    redirect(`/profile?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/profile");

  if (next) {
    redirect(`${next}?message=${encodeURIComponent("Profile saved.")}`);
  }

  redirect("/profile?saved=1");
}
```

- [ ] **Step 3: Write the profile page**

```tsx
// src/app/profile/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "@/app/actions/profile";
import SkillLevelPicker from "@/components/SkillLevelPicker";
import SuccessBanner from "@/components/SuccessBanner";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; message?: string; saved?: string; error?: string }>;
}) {
  const { next, message, saved, error } = await searchParams;
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
    .select("name, gender, skill_level")
    .eq("id", user.id)
    .single();

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
        <button type="submit" className="w-fit rounded bg-black px-4 py-2 text-sm text-white">
          Save
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add the nav link**

In `src/components/AppShell.tsx`, add a new active-state check alongside
the existing ones:

```tsx
  const profileActive = pathname.startsWith("/profile");
```

Add the link in the `<nav>`, immediately after "My Events" (inside the
same `{userEmail && (...)}` gating pattern the other signed-in-only links
use):

```tsx
          {userEmail && (
            <Link
              href="/profile"
              className={linkClass(profileActive)}
              onClick={() => setOpen(false)}
            >
              Profile
            </Link>
          )}
```

- [ ] **Step 5: Run the test suite (regression only — no new tests this task)**

Run: `npm test`
Expected: PASS, same tests as before plus Task 2's new tests

- [ ] **Step 6: Commit**

```bash
git add src/components/SkillLevelPicker.tsx src/app/actions/profile.ts src/app/profile/page.tsx src/components/AppShell.tsx
git commit -m "Add the profile page, updateProfile action, and nav link"
```

---

### Task 4: Registration gate

**Files:**
- Modify: `src/app/actions/events.ts`

**Interfaces:**
- Consumes: `isProfileComplete` from Task 2.

- [ ] **Step 1: Add `event_type` to the event query and the gate check**

In `src/app/actions/events.ts`, add the import:

```ts
import { isProfileComplete } from "@/lib/userProfile";
```

Change the `event` query's select list to include `event_type`:

```ts
  const { data: event } = await supabase
    .from("events")
    .select("event_type, capacity, registration_mode, team_formation, status")
    .eq("id", eventId)
    .single();
```

Add the gate right after the existing event-status check:

```ts
  if (event.status !== "published" && event.status !== "registration_open") {
    redirect(`/events/${eventId}?register_error=${encodeURIComponent("Registration isn't open for this event.")}`);
  }

  if (event.event_type !== "open_play") {
    const { data: profile } = await supabase
      .from("users")
      .select("name, gender, skill_level")
      .eq("id", user.id)
      .single();

    if (!profile || !isProfileComplete(profile)) {
      redirect(
        `/profile?next=${encodeURIComponent(`/events/${eventId}`)}&message=${encodeURIComponent("Complete your profile to register for this event.")}`
      );
    }
  }
```

(This goes between the existing event-status check and the existing
`if (event.registration_mode === "individual" && !displayName)` check —
order between those two doesn't matter, but the gate must come after the
event-status check since an event that isn't open for registration at
all shouldn't redirect to `/profile` first.)

- [ ] **Step 2: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "Gate non-open_play event registration on a complete profile"
```

---

### Task 5: Pre-fill display names from the profile

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`

**Interfaces:**
- No new exports — reads `users.name` for the currently signed-in viewer.

- [ ] **Step 1: Fetch the viewer's profile name**

In `src/app/events/[eventId]/page.tsx`, inside the existing `if (user) {
... }` block (where `myRegistration`/`registeredCount` are already
computed), add:

```tsx
  let profileName: string | null = null;

  if (user) {
    // ...existing individualReg / memberships / registeredCount logic...

    const { data: profile } = await supabase.from("users").select("name").eq("id", user.id).single();
    profileName = profile?.name ?? null;
  }
```

(`profileName` is declared alongside the existing `myRegistration`/
`myTeamName`/`registeredCount` declarations above the `if (user)` block,
same pattern already used there.)

- [ ] **Step 2: Pre-fill both display-name inputs**

Change the captain display-name input:

```tsx
                  <label className="flex flex-col gap-1 text-sm">
                    Your display name (shown on the roster)
                    <input
                      name="captain_display_name"
                      defaultValue={profileName ?? ""}
                      required
                      className="rounded border px-3 py-2"
                    />
                  </label>
```

Change the individual-registration display-name input:

```tsx
                  <label className="flex flex-col gap-1 text-sm">
                    Display name (shown in results)
                    <input
                      name="display_name"
                      defaultValue={profileName ?? ""}
                      required
                      className="rounded border px-3 py-2"
                    />
                  </label>
```

- [ ] **Step 3: Run the test suite (regression only)**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add "src/app/events/[eventId]/page.tsx"
git commit -m "Pre-fill registration display-name fields from the player's profile"
```

---

## Manual verification plan (after all tasks)

- Apply and verify the migration (Task 1, Step 3 already covers
  schema-level checks).
- As a fresh test account, confirm `/profile` shows all three fields
  empty; set name/gender/skill level (try both the letter and
  plain-language skill pickers — confirm a plain-language pick like
  Advanced actually stores `A`) and save; confirm the values persist on
  reload.
- With that profile still incomplete (e.g. before saving), attempt to
  register for a `tournament`/`league`/`clinic` event; confirm the
  redirect to `/profile` with the completion message, and confirm
  completing the profile there redirects back to the original event.
- Confirm the same account *can* register for an `open_play` event
  without being redirected to `/profile` at all.
- Confirm a player with a saved `name` sees it pre-filled (but still
  editable/overridable) on both the individual-registration and
  self-formed-team-captain display-name fields.
- Confirm a player who registered for a non-open-play event before this
  shipped is completely unaffected — no forced profile completion just
  to view their existing registration.
- Confirm the new "Profile" nav link appears only when signed in, and
  that `/profile` itself redirects a signed-out visitor to `/login`
  (round-tripping back to `/profile` after sign-in).
