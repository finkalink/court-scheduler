-- One override row per court per date, so the admin "date overrides" UI can
-- upsert safely instead of accumulating duplicate rows for the same date.
alter table slot_overrides
  add constraint slot_overrides_court_date_unique unique (court_id, date);
