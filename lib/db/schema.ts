export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  item_description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  daily_rate_cents INTEGER NOT NULL,
  days INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL,
  replacement_cents INTEGER NOT NULL,
  replacement_source TEXT,
  purchase_year INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'draft',
  paypal_order_id TEXT,
  paypal_authorization_id TEXT,
  authorized_cents INTEGER NOT NULL DEFAULT 0,
  captured_cents INTEGER NOT NULL DEFAULT 0,
  released_cents INTEGER NOT NULL DEFAULT 0,
  paypal_capture_id TEXT,
  overage_invoice_id TEXT,
  renter_note TEXT,
  owner_token TEXT,
  payer_email TEXT,
  excluded_finding_ids TEXT,
  settle_basis TEXT,
  renter_token_hash TEXT,
  settle_quote TEXT,
  hold_nonce_hash TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  angle TEXT NOT NULL,
  path TEXT NOT NULL,
  quality_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_rental ON photos(rental_id, phase, angle);
CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  photo_hash TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL,
  usage_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inspections_rental ON inspections(rental_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inspections_hash ON inspections(photo_hash);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  rental_id TEXT NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_rental ON events(rental_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  rental_id TEXT,
  created_at TEXT NOT NULL
);
`;

/** Columns added after the first release; applied to databases created earlier. */
export const ADDED_RENTAL_COLUMNS = ["owner_token", "payer_email", "excluded_finding_ids", "settle_basis", "renter_token_hash", "settle_quote", "hold_nonce_hash"] as const;
