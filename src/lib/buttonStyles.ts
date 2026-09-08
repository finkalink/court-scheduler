// Shared button styling: `primary` (bg-accent) is for anything that submits,
// commits, or changes state; `secondary` is a bordered neutral style for
// less prominent actions in the same category. Plain navigation should stay
// a text link (`text-link underline`), not this helper.
type Variant = "primary" | "secondary";

export function buttonClass(variant: Variant, opts?: { disabled?: boolean }): string {
  const base = "inline-block rounded px-4 py-2 text-sm font-medium";

  if (opts?.disabled) {
    return `${base} cursor-not-allowed bg-active text-fg-muted`;
  }

  if (variant === "primary") {
    return `${base} bg-accent text-accent-fg hover:bg-accent-hover`;
  }

  return `${base} border border-border text-fg hover:bg-active`;
}
