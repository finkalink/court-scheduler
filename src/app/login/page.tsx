import type { Metadata } from "next";
import { signIn } from "@/app/actions/auth";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Sign In" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm px-4 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Sign In</h1>

      {message && (
        <p className="mt-4 rounded bg-active p-3 text-sm text-fg">
          {message}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">
          {error}
        </p>
      )}

      <form action={signIn} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required className="rounded border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input name="password" type="password" required className="rounded border border-border px-3 py-2" />
        </label>
        <button type="submit" className={buttonClass("primary")}>
          Sign in
        </button>
      </form>

      <p className="mt-4 text-sm text-fg-muted">
        No account?{" "}
        <a href="/signup" className="underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
