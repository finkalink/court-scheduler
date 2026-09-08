import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";
import { isValidTheme, THEME_COOKIE_NAME } from "@/lib/theme";
import AppShell from "@/components/AppShell";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Court Scheduler",
  description: "Book open court time slots",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const membership = await getCurrentMembership(supabase, user?.id);

  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const initialTheme = isValidTheme(themeCookie) ? themeCookie : null;

  return (
    <html
      lang="en"
      data-theme={initialTheme ?? undefined}
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell userEmail={user?.email ?? null} isOrgMember={!!membership} initialTheme={initialTheme}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
