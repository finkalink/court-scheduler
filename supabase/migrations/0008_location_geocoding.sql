-- Structured geocoding detail for locations, captured via an address lookup
-- (OpenStreetMap/Nominatim) when an admin adds or edits a location. Feeds
-- the "open in maps" links on player-facing pages now, and is the
-- coordinate/zip source the future weather-forecast feature needs.
-- Nullable, no backfill: existing locations just show as "not yet verified"
-- until an admin re-saves their address through the lookup flow.
alter table locations
  add column postal_code text,
  add column latitude double precision,
  add column longitude double precision,
  add column formatted_address text;
