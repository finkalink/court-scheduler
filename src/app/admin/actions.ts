"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const DAYS = [0, 1, 2, 3, 4, 5, 6];

export async function saveAvailability(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const supabase = await createClient();

  const rows = DAYS.map((day) => {
    const open = formData.get(`open_${day}`);
    const close = formData.get(`close_${day}`);
    if (!open || !close) return null;
    return {
      court_id: courtId,
      day_of_week: day,
      open_time: String(open),
      close_time: String(close),
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);

  // Full-week replace: simplest correct model for v1 (one rule per day).
  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("court_id", courtId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("availability_rules").insert(rows);
    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  revalidatePath("/admin");
  revalidatePath("/");
}
