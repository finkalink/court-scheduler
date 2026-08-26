"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const EXCLUSION_VIOLATION = "23P01";

export async function createBooking(formData: FormData) {
  const courtId = String(formData.get("court_id"));
  const locationId = String(formData.get("location_id"));
  const startTime = String(formData.get("start_time"));
  const endTime = String(formData.get("end_time"));
  const date = String(formData.get("date"));
  const requestedNetHeight = String(formData.get("requested_net_height") || "") || null;
  const requestedCourtLines = String(formData.get("requested_court_lines") || "") || null;

  const courtPath = `/locations/${locationId}/courts/${courtId}`;
  const bookPath = `${courtPath}/book?start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}&date=${date}`;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(bookPath)}`);
  }

  const { error } = await supabase.from("bookings").insert({
    court_id: courtId,
    user_id: user.id,
    start_time: startTime,
    end_time: endTime,
    requested_net_height: requestedNetHeight,
    requested_court_lines: requestedCourtLines,
  });

  if (error) {
    const message =
      error.code === EXCLUSION_VIOLATION
        ? "That slot was just taken. Pick another one."
        : error.message;
    redirect(`${courtPath}?date=${date}&error=${encodeURIComponent(message)}`);
  }

  redirect(`${courtPath}?date=${date}&booked=1`);
}
