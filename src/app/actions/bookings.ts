"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const EXCLUSION_VIOLATION = "23P01";

export async function createBooking(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const startTime = String(formData.get("start_time"));
  const endTime = String(formData.get("end_time"));
  const date = String(formData.get("date"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/?date=${date}`)}`);
  }

  const { error } = await supabase.from("bookings").insert({
    court_id: courtId,
    user_id: user.id,
    start_time: startTime,
    end_time: endTime,
  });

  if (error) {
    const message =
      error.code === EXCLUSION_VIOLATION
        ? "That slot was just taken. Pick another one."
        : error.message;
    redirect(`/?date=${date}&error=${encodeURIComponent(message)}`);
  }

  redirect(`/?date=${date}&booked=1`);
}
