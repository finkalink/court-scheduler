import type { Metadata } from "next";
import { signUp } from "@/app/actions/auth";
import { buttonClass } from "@/lib/buttonStyles";

export const metadata: Metadata = { title: "Sign Up" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm px-4 sm:px-0">
      <h1 className="text-xl font-semibold sm:text-2xl">Create an Account</h1>

      {error && (
        <p className="mt-4 rounded bg-error-bg p-3 text-sm text-error-fg">
          {error}
        </p>
      )}

      <form action={signUp} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required className="rounded border border-border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={6}
            className="rounded border border-border px-3 py-2"
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="agreed_to_terms" required className="mt-0.5" />
          <span>
            I agree to the{" "}
            <a href="/terms" target="_blank" rel="noreferrer" className="underline">
              Terms of Service and Acceptable Use Policy
            </a>
            .
          </span>
        </label>
        <button type="submit" className={buttonClass("primary")}>
          Sign up
        </button>
      </form>

      <p className="mt-4 text-sm text-fg-muted">
        Already have an account?{" "}
        <a href="/login" className="underline">
          Sign in
        </a>
      </p>
    </div>
  );
}
