// A safe redirect target must be a same-origin relative path: starts with a
// single "/" and not "//" or "/\" (both of which browsers can treat as
// protocol-relative, i.e. off-site).
export function isSafeRedirectPath(path: string): boolean {
  return Boolean(path) && /^\/(?!\/|\\)/.test(path);
}
