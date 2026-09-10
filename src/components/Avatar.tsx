const SIZES = {
  sm: "h-8 w-8",
  md: "h-16 w-16",
  lg: "h-28 w-28",
} as const;

export default function Avatar({
  url,
  size = "md",
  alt = "",
}: {
  url: string | null;
  size?: keyof typeof SIZES;
  alt?: string;
}) {
  const className = `${SIZES[size]} shrink-0 overflow-hidden rounded-full bg-active`;

  if (url) {
    // No next/image usage anywhere in this codebase yet -- a plain <img> avoids adding remote-domain config for one feature.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} className={`${className} object-cover`} />;
  }

  return (
    <span className={`${className} flex items-center justify-center text-fg-muted`} aria-hidden={alt === ""}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3/5 w-3/5" role={alt ? "img" : undefined} aria-label={alt || undefined}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8v1H4z" />
      </svg>
    </span>
  );
}
