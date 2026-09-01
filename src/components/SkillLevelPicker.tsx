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
