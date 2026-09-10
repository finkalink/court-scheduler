import { describe, expect, it } from "vitest";
import { parseMarkdownLite } from "./markdownLite";

describe("parseMarkdownLite", () => {
  it("parses a level-1 heading", () => {
    expect(parseMarkdownLite("# Terms of Service")).toEqual([
      { type: "heading", level: 1, text: "Terms of Service" },
    ]);
  });

  it("parses level-2 and level-3 headings", () => {
    expect(parseMarkdownLite("## Terms of Service\n\n### 1. Eligibility")).toEqual([
      { type: "heading", level: 2, text: "Terms of Service" },
      { type: "heading", level: 3, text: "1. Eligibility" },
    ]);
  });

  it("parses a single-line paragraph", () => {
    expect(parseMarkdownLite("**Last updated:** [DATE]")).toEqual([
      { type: "paragraph", text: "**Last updated:** [DATE]" },
    ]);
  });

  it("joins a wrapped paragraph's lines into one block", () => {
    const md = "These Terms govern access to\nand use of the Service.";
    expect(parseMarkdownLite(md)).toEqual([
      { type: "paragraph", text: "These Terms govern access to and use of the Service." },
    ]);
  });

  it("parses a bullet list", () => {
    const md = "- First rule;\n- Second rule;\n- Third rule.";
    expect(parseMarkdownLite(md)).toEqual([
      { type: "list", items: ["First rule;", "Second rule;", "Third rule."] },
    ]);
  });

  it("parses a horizontal rule", () => {
    expect(parseMarkdownLite("---")).toEqual([{ type: "hr" }]);
  });

  it("parses a single-paragraph blockquote", () => {
    const md = "> This is a placeholder, not a finished legal document.";
    expect(parseMarkdownLite(md)).toEqual([
      { type: "blockquote", paragraphs: ["This is a placeholder, not a finished legal document."] },
    ]);
  });

  it("parses a blockquote with an internal blank-quote-line splitting two paragraphs", () => {
    const md = ["> First blockquote paragraph.", ">", "> Second blockquote paragraph."].join("\n");
    expect(parseMarkdownLite(md)).toEqual([
      {
        type: "blockquote",
        paragraphs: ["First blockquote paragraph.", "Second blockquote paragraph."],
      },
    ]);
  });

  it("parses a realistic multi-block sequence matching the draft doc's opening", () => {
    const md = [
      "# Terms of Service & Acceptable Use Policy — DRAFT",
      "",
      "> This is a placeholder.",
      ">",
      "> Two documents are combined here.",
      "",
      "---",
      "",
      "## Terms of Service",
      "",
      "**Last updated:** [DATE]",
    ].join("\n");

    expect(parseMarkdownLite(md)).toEqual([
      { type: "heading", level: 1, text: "Terms of Service & Acceptable Use Policy — DRAFT" },
      {
        type: "blockquote",
        paragraphs: ["This is a placeholder.", "Two documents are combined here."],
      },
      { type: "hr" },
      { type: "heading", level: 2, text: "Terms of Service" },
      { type: "paragraph", text: "**Last updated:** [DATE]" },
    ]);
  });
});
