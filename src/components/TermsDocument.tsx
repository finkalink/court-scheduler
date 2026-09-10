import type { Block } from "@/lib/markdownLite";

// Simple inline-span splitting (bold, inline code) -- not part of the
// tested block parser (src/lib/markdownLite.ts), since this is rendering,
// not document structure.
function renderInline(text: string) {
  const parts = text.split(/(\*\*.+?\*\*|`.+?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-active px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const HEADING_CLASSES: Record<1 | 2 | 3, string> = {
  1: "mt-6 text-xl font-semibold sm:text-2xl",
  2: "mt-8 text-lg font-semibold",
  3: "mt-6 text-base font-semibold",
};

export default function TermsDocument({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const Tag = (`h${block.level}` as const);
          return (
            <Tag key={i} className={HEADING_CLASSES[block.level]}>
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.type === "paragraph") {
          return <p key={i}>{renderInline(block.text)}</p>;
        }
        if (block.type === "list") {
          return (
            <ul key={i} className="list-disc pl-5">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "hr") {
          return <hr key={i} className="border-border" />;
        }
        return (
          <blockquote key={i} className="flex flex-col gap-2 border-l-2 border-border pl-4 text-fg-muted">
            {block.paragraphs.map((p, j) => (
              <p key={j}>{renderInline(p)}</p>
            ))}
          </blockquote>
        );
      })}
    </div>
  );
}
