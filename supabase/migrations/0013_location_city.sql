-- Nullable, no backfill -- same pattern as slot_size_minutes and the
-- geocoding columns (0008_location_geocoding.sql). Existing locations show
-- under the home page's "Other locations" fallback until an admin re-saves
-- their address through the lookup flow, which now also captures city.
alter table locations add column city text;
