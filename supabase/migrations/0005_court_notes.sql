-- Optional free-text description a court's org can attach (e.g. "enter
-- through the side door", "bring your own net strap"), shown to players on
-- the booking page. Nullable, no default: most courts won't need one.
alter table courts add column notes text;
