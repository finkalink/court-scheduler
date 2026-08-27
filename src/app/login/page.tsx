import { signIn } from "@/app/actions/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next } = await searchParams;

  return (
    <div className="mx-auto mt-16 max-w-sm px-4 sm:px-0">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      {message && <p className="mt-4 rounded bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
      {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <form action={signIn} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input name="password" type="password" required className="rounded border px-3 py-2" />
        </label>
        <button type="submit" className="rounded bg-black px-4 py-2 text-white">
          Sign in
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        No account?{" "}
        <a href="/signup" className="underline">
          Sign up
        </a>
      </p>
    </div>
  );
}
