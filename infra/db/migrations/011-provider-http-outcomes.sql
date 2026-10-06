BEGIN;
-- No prompt, key, provider error body or private data is stored here.
ALTER TABLE campus_usage_reservations ADD COLUMN upstream_status integer CHECK(upstream_status BETWEEN 200 AND 599);
ALTER TABLE campus_usage_reservations ADD COLUMN settlement_basis text;
ALTER TABLE campus_usage_reservations ADD COLUMN settled_at timestamptz;
COMMIT;
