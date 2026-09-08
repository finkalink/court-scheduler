import { EVENT_TYPE_LABELS } from "@/lib/eventTypes";

export default function EventTypeBadge({ eventType }: { eventType: string }) {
  return (
    <span className="inline-block rounded-full bg-status px-3 py-0.5 text-xs font-medium text-status-fg">
      {EVENT_TYPE_LABELS[eventType] ?? eventType}
    </span>
  );
}
