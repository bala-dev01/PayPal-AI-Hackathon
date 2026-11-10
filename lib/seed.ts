import type { DatabaseSync } from "node:sqlite";

/**
 * Sample rentals for the owner console. Every one is flagged is_sample = 1 and
 * labelled "SAMPLE" in its own data. None carries PayPal IDs or photos, so they
 * use the "draft" status only (a "held" rental would imply a real authorization).
 */
const SAMPLES = [
  { item: "Mirrorless camera body and 24-70mm lens", cat: "camera", rate: 4500, days: 3, dep: 15000, repl: 189900, year: 2023 },
  { item: "Cordless rotary hammer drill kit", cat: "tools", rate: 2200, days: 2, dep: 8000, repl: 42900, year: 2022 },
  { item: "Folding e-bike, 20 inch", cat: "e-bike", rate: 3500, days: 3, dep: 20000, repl: 149900, year: 2024 },
  { item: "Portable PA speaker with stand", cat: "party", rate: 3000, days: 1, dep: 10000, repl: 89900, year: 2021 },
  { item: "Acoustic guitar, dreadnought", cat: "instrument", rate: 1800, days: 3, dep: 12000, repl: 64900, year: 2020 },
];

/** Idempotent: only seeds an empty rentals table. */
export function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM rentals").get();
  if (Number(row?.n ?? 0) > 0) return;
  const insert = db.prepare(
    `INSERT INTO rentals (id,item_name,item_description,category,daily_rate_cents,days,deposit_cents,
      replacement_cents,replacement_source,purchase_year,currency,status,is_sample,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  );
  const t = new Date().toISOString();
  SAMPLES.forEach((s, i) => {
    insert.run(
      `sample_${i + 1}`,
      `SAMPLE: ${s.item}`,
      "Sample rental so the owner console is not empty. It has no photos and no PayPal hold.",
      s.cat,
      s.rate,
      s.days,
      s.dep,
      s.repl,
      "Sample figure, not a live price",
      s.year,
      "USD",
      "draft",
      t,
      t,
    );
  });
}
