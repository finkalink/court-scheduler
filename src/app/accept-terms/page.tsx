import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTermsBlocks } from "@/lib/termsContent";
import TermsDocument from "@/components/TermsDocument";
import { acceptTerms } from "@/app/actions/terms";
import { isSafeRedirectPath } from "@/lib/redirects";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Accept Terms" };

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = rawNext && isSafeRedirectPath(rawNext) ? rawNext : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginNext = `/accept-terms${next ? `?next=${encodeURIComponent(next)}` : ""}`;
    redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  }

  const blocks = getTermsBlocks();

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">
        Accept Terms<span className="text-accent">.</span>
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Please review and accept the current Terms of Service before continuing.
      </p>

      {error && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">
          {error}
        </p>
      )}

      <div className="mt-6 max-h-[60vh] overflow-y-auto rounded border border-border p-4">
        <TermsDocument blocks={blocks} />
      </div>

      <form action={acceptTerms} className="mt-6">
        {next && <input type="hidden" name="next" value={next} />}
        <button type="submit" className={buttonClass("primary")}>
          I Agree and Continue
        </button>
      </form>
    </div>
  );
}
