import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembership } from "@/lib/orgMembership";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin");
  }

  const membership = await getCurrentMembership(supabase, user.id);

  if (!membership) {
    return (
      <div className="mx-auto mt-16 max-w-lg text-center text-gray-600">
        Your account ({user.email}) isn&apos;t a member of any organization.
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl px-4 sm:mt-10 sm:px-0">{children}</div>
  );
}
