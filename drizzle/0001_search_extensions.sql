-- Fuzzy zoeken (achternamen, klantnamen) en zoeken in contactgegevens
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_last_name_key_trgm ON contacts USING gin (last_name_key gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customers_display_name_trgm ON customers USING gin (lower(display_name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contact_points_normalized_trgm ON contact_points USING gin (normalized gin_trgm_ops);
