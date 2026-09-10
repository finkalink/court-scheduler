import { readFileSync } from "fs";
import path from "path";
import { parseMarkdownLite, type Block } from "@/lib/markdownLite";

export function getTermsBlocks(): Block[] {
  const filePath = path.join(process.cwd(), "docs/legal/terms-of-service-draft.md");
  const text = readFileSync(filePath, "utf8");
  return parseMarkdownLite(text);
}
