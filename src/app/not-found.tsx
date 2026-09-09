import Link from "next/link";
import { buttonClass } from "@/lib/buttonStyles";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center sm:px-0">
      <p className="font-display text-sm uppercase tracking-[0.15em] text-accent">404</p>
      <h1 className="font-display mt-2 text-4xl uppercase leading-none text-fg">
        Out of bounds<span className="text-accent">.</span>
      </h1>
      <p className="mt-4 text-sm text-fg-muted">
        That page doesn&apos;t exist -- it may have moved, or the link&apos;s out of date.
      </p>
      <Link href="/" className={`mt-6 inline-block ${buttonClass("primary")}`}>
        Back to courts
      </Link>
    </div>
  );
}
