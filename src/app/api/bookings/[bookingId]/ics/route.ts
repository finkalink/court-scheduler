import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIcsContent } from "@/lib/calendarLinks";
import { formatRequestedConfig } from "@/lib/courtConfig";
import { getAppUrl } from "@/lib/appUrl";

export async function GET(request: NextRequest, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createClient();

  // RLS ("bookings select own"/"bookings select org member") is what
  // actually decides whether this caller can see this booking -- same
  // pattern as the /bookings/[bookingId] page.
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, start_time, end_time, requested_net_height, requested_court_lines, court:courts(name, location:locations(organization:organizations(name)))"
    )
    .eq("id", bookingId)
    .single();

  if (!booking) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const court = Array.isArray(booking.court) ? booking.court[0] : booking.court;
  const location = Array.isArray(court?.location) ? court?.location[0] : court?.location;
  const organization = Array.isArray(location?.organization) ? location?.organization[0] : location?.organization;
  const courtName = court?.name ?? "the court";
  const title = organization?.name ? `${courtName} · ${organization.name}` : courtName;

  const ics = buildIcsContent({
    uid: `${booking.id}@court-scheduler`,
    title,
    location: title,
    startTime: booking.start_time,
    endTime: booking.end_time,
    description: formatRequestedConfig(booking.requested_net_height, booking.requested_court_lines),
    url: `${getAppUrl()}/bookings/${booking.id}`,
  });

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="booking.ics"`,
    },
  });
}
