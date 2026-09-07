export type Theme = "light" | "dark";

export const THEME_COOKIE_NAME = "theme";

export function isValidTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark";
}
