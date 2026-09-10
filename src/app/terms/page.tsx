import type { Metadata } from "next";
import { getTermsBlocks } from "@/lib/termsContent";
import TermsDocument from "@/components/TermsDocument";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const blocks = getTermsBlocks();

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <TermsDocument blocks={blocks} />
    </div>
  );
}
