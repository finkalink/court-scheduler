export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "hr" }
  | { type: "blockquote"; paragraphs: string[] };

// A narrow, purpose-built parser covering exactly what
// docs/legal/terms-of-service-draft.md uses -- not general-purpose
// markdown. Inline formatting (e.g. **bold**) is left untouched in the
// returned text; splitting it into spans happens at render time instead.
export function parseMarkdownLite(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const paragraphs = quoteLines
        .join("\n")
        .split(/\n(?:\s*\n)+/)
        .map((p) => p.replace(/\n/g, " ").trim())
        .filter(Boolean);
      blocks.push({ type: "blockquote", paragraphs });
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, "").trim());
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      lines[i].trim() !== "---" &&
      !lines[i].startsWith(">") &&
      !/^-\s+/.test(lines[i])
    ) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}
