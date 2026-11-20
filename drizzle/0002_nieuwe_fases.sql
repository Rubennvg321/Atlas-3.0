-- Nieuwe fases volgens de kaartenbak (november 2026)
INSERT INTO pipeline_stages (key, label, position, kind, color, active) VALUES
  ('in_afwachting', 'In afwachting', 1, 'open', 'zinc', true),
  ('lead', 'Lead', 2, 'open', 'sky', true),
  ('offerte_gepland', 'Offerte gepland', 3, 'open', 'amber', true),
  ('offerte_gemaakt', 'Offerte gemaakt', 4, 'open', 'violet', true),
  ('offerte_geaccepteerd', 'Offerte geaccepteerd', 5, 'won', 'emerald', true),
  ('montage_gepland', 'Montage gepland', 6, 'won', 'rose', true),
  ('materiaal_besteld', 'Materiaal besteld', 7, 'won', 'orange', true),
  ('in_uitvoering', 'In uitvoering', 8, 'won', 'teal', true),
  ('review_gestuurd', 'Review gestuurd', 9, 'done', 'indigo', true),
  ('review_ontvangen', 'Review ontvangen', 10, 'done', 'slate', true),
  ('vervallen', 'Vervallen', 99, 'lost', 'zinc', true)
ON CONFLICT (key) DO UPDATE SET position = EXCLUDED.position, kind = EXCLUDED.kind, active = true;
--> statement-breakpoint
UPDATE trajects SET stage = CASE stage
  WHEN 'afspraak' THEN 'offerte_gepland'
  WHEN 'offerte' THEN 'offerte_gemaakt'
  WHEN 'opdracht' THEN 'offerte_geaccepteerd'
  WHEN 'montage' THEN 'montage_gepland'
  WHEN 'afgerond' THEN 'review_gestuurd'
  ELSE stage END
WHERE stage IN ('afspraak','offerte','opdracht','montage','afgerond');
--> statement-breakpoint
-- Oude fases blijven bestaan (voor de historie in het logboek), maar zijn niet meer actief.
UPDATE pipeline_stages SET active = false WHERE key IN ('afspraak','offerte','opdracht','montage','afgerond');
