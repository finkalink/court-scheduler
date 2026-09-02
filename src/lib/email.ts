import { Resend } from "resend";
import { buildGoogleCalendarUrl, buildIcsContent, buildOutlookCalendarUrl } from "@/lib/calendarLinks";

export interface BookingEmailDetails {
  bookingId: string;
  dateLabel: string;
  timeLabel: string;
  courtName: string;
  organizationName: string | null;
  requestedConfig: string | null;
  appUrl: string;
  startTime: string;
  endTime: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function bookingSummaryLines(details: BookingEmailDetails): string[] {
  const lines = [
    `${details.dateLabel} · ${details.timeLabel}`,
    details.organizationName ? `${details.courtName} · ${details.organizationName}` : details.courtName,
  ];
  if (details.requestedConfig) lines.push(details.requestedConfig);
  return lines;
}

function calendarEvent(details: BookingEmailDetails, bookingUrl: string) {
  return {
    title: details.organizationName ? `${details.courtName} · ${details.organizationName}` : details.courtName,
    startTime: details.startTime,
    endTime: details.endTime,
    location: details.organizationName ? `${details.courtName} · ${details.organizationName}` : details.courtName,
    description: details.requestedConfig,
    url: bookingUrl,
  };
}

export function buildBookingConfirmationEmail(details: BookingEmailDetails): EmailContent {
  const summary = bookingSummaryLines(details);
  const bookingUrl = `${details.appUrl}/bookings/${details.bookingId}`;
  const event = calendarEvent(details, bookingUrl);
  const googleUrl = buildGoogleCalendarUrl(event);
  const outlookUrl = buildOutlookCalendarUrl(event);
  const icsUrl = `${details.appUrl}/api/bookings/${details.bookingId}/ics`;

  return {
    subject: "Booking confirmed",
    text: [
      `Your booking is confirmed:`,
      "",
      ...summary,
      "",
      `View your booking: ${bookingUrl}`,
      "",
      `Add to calendar -- Google: ${googleUrl}`,
      `Add to calendar -- Outlook: ${outlookUrl}`,
      `Add to calendar -- Apple/other (.ics): ${icsUrl}`,
    ].join("\n"),
    html: [
      `<p>Your booking is confirmed:</p>`,
      `<p>${summary.map(escapeHtml).join("<br>")}</p>`,
      `<p><a href="${bookingUrl}">View your booking</a></p>`,
      `<p>Add to calendar: <a href="${googleUrl}">Google</a> · <a href="${outlookUrl}">Outlook</a> · <a href="${icsUrl}">Apple / other (.ics)</a></p>`,
    ].join("\n"),
  };
}

export function buildBookingCancellationEmail(details: BookingEmailDetails): EmailContent {
  const summary = bookingSummaryLines(details);

  return {
    subject: "Booking cancelled",
    text: [`This booking has been cancelled:`, "", ...summary].join("\n"),
    html: [`<p>This booking has been cancelled:</p>`, `<p>${summary.map(escapeHtml).join("<br>")}</p>`].join(
      "\n"
    ),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || "Court Scheduler <onboarding@resend.dev>";

export async function sendEmail(to: string, content: EmailContent): Promise<void> {
  if (!resendClient) {
    console.warn("RESEND_API_KEY not set -- skipping email send:", content.subject, "to", to);
    return;
  }

  try {
    await resendClient.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
