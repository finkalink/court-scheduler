export const NET_HEIGHT_OPTIONS = [
  { value: "", label: "No preference" },
  { value: "mens", label: "Men's" },
  { value: "womens", label: "Women's" },
] as const;

export const COURT_LINES_OPTIONS = [
  { value: "", label: "No preference" },
  { value: "4s", label: "4s" },
  { value: "6s", label: "6s" },
] as const;

const NET_HEIGHT_LABELS: Record<string, string> = {
  mens: "Men's",
  womens: "Women's",
};

export function formatRequestedConfig(
  netHeight: string | null,
  courtLines: string | null
): string | null {
  const parts: string[] = [];
  if (netHeight) parts.push(`Net: ${NET_HEIGHT_LABELS[netHeight] ?? netHeight}`);
  if (courtLines) parts.push(`Lines: ${courtLines}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
