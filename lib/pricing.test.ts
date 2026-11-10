import { describe, expect, it } from "vitest";
import {
  captureTotalCents,
  depreciatedBaseCents,
  formatCents,
  nonChargeableReason,
  priceFindings,
} from "./pricing";
import type { Finding } from "./types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    angle: "front",
    title: "Dent",
    description: "",
    classification: "new_damage",
    severity: "minor",
    confidence: 0.9,
    region_before: null,
    region_after: null,
    ...over,
  };
}
const base = { replacementCents: 100000, purchaseYear: 2026, depositCents: 20000, currentYear: 2026 };

describe("depreciation", () => {
  it("is full value in the purchase year and when year unknown", () => {
    expect(depreciatedBaseCents(100000, 2026, 2026)).toBe(100000);
    expect(depreciatedBaseCents(100000, null, 2026)).toBe(100000);
  });
  it("loses 15% per year", () => {
    expect(depreciatedBaseCents(100000, 2025, 2026)).toBe(85000);
    expect(depreciatedBaseCents(100000, 2023, 2026)).toBe(55000);
  });
  it("floors at 40%", () => {
    expect(depreciatedBaseCents(100000, 2020, 2026)).toBe(40000);
    expect(depreciatedBaseCents(100000, 1990, 2026)).toBe(40000);
  });
  it("treats a future purchase year as new", () => {
    expect(depreciatedBaseCents(100000, 2030, 2026)).toBe(100000);
  });
  it("returns integers", () => {
    expect(Number.isInteger(depreciatedBaseCents(12345, 2024, 2026))).toBe(true);
  });
});

describe("chargeability", () => {
  it("charges at exactly 0.75 confidence", () => {
    expect(priceFindings({ ...base, findings: [finding({ confidence: 0.75 })] }).damageCents).toBe(3000);
  });
  it("does not charge just below 0.75", () => {
    const r = priceFindings({ ...base, findings: [finding({ confidence: 0.7499 })] });
    expect(r.damageCents).toBe(0);
    expect(r.lines[0]?.chargeable).toBe(false);
    expect(r.lines[0]?.reason).toBe("Confidence below 75%");
  });
  it("does not charge NaN confidence", () => {
    expect(nonChargeableReason(finding({ confidence: NaN }))).not.toBeNull();
  });
  it.each(["pre_existing", "normal_wear", "uncertain"] as const)("never charges %s, even destroyed at 1.0", (c) => {
    const r = priceFindings({
      ...base,
      findings: [finding({ classification: c, severity: "destroyed", confidence: 1 })],
    });
    expect(r.damageCents).toBe(0);
    expect(r.lines[0]?.amountCents).toBe(0);
    expect(r.lines[0]?.reason).toBeTruthy();
  });
  it("cosmetic new damage costs nothing", () => {
    expect(priceFindings({ ...base, findings: [finding({ severity: "cosmetic" })] }).damageCents).toBe(0);
  });
});

describe("severity rates", () => {
  it.each([
    ["minor", 3000],
    ["moderate", 12000],
    ["major", 35000],
    ["destroyed", 100000],
  ] as const)("%s", (severity, cents) => {
    expect(priceFindings({ ...base, depositCents: 0, findings: [finding({ severity })] }).damageCents).toBe(cents);
  });
});

describe("totals", () => {
  it("sums and caps at base value", () => {
    const r = priceFindings({
      ...base,
      findings: [finding({ id: "a", severity: "destroyed" }), finding({ id: "b", severity: "major" })],
    });
    expect(r.damageCents).toBe(100000);
  });
  it("damage under deposit: all from deposit, remainder released", () => {
    const r = priceFindings({ ...base, findings: [finding({ severity: "minor" })] });
    expect(r.depositCapturedCents).toBe(3000);
    expect(r.overageCents).toBe(0);
    expect(r.depositReleasedCents).toBe(17000);
  });
  it("damage equal to deposit leaves no overage and nothing released", () => {
    const r = priceFindings({ ...base, depositCents: 3000, findings: [finding({ severity: "minor" })] });
    expect(r.depositCapturedCents).toBe(3000);
    expect(r.overageCents).toBe(0);
    expect(r.depositReleasedCents).toBe(0);
  });
  it("damage over deposit: deposit captured, excess is overage", () => {
    const r = priceFindings({ ...base, findings: [finding({ severity: "major" })] });
    expect(r.depositCapturedCents).toBe(20000);
    expect(r.overageCents).toBe(15000);
    expect(r.depositReleasedCents).toBe(0);
  });
  it("no findings releases the whole deposit", () => {
    const r = priceFindings({ ...base, findings: [] });
    expect(r.depositReleasedCents).toBe(20000);
    expect(r.damageCents).toBe(0);
  });
  it("amounts reconcile", () => {
    const r = priceFindings({ ...base, findings: [finding({ severity: "moderate" })] });
    expect(r.depositCapturedCents + r.depositReleasedCents).toBe(20000);
    expect(r.depositCapturedCents + r.overageCents).toBe(r.damageCents);
  });
  it("rounds to integer cents", () => {
    const r = priceFindings({
      replacementCents: 9999,
      purchaseYear: 2024,
      currentYear: 2026,
      depositCents: 5000,
      findings: [finding({ severity: "minor" })],
    });
    expect(r.baseValueCents).toBe(6999); // round(9999 * 0.7)
    expect(r.damageCents).toBe(210); // 209.97 rounded
    for (const v of [r.damageCents, r.depositCapturedCents, r.overageCents, r.depositReleasedCents]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

describe("captureTotalCents", () => {
  const r = priceFindings({ ...base, findings: [finding({ severity: "minor" })] });
  it("adds fee and deposit share", () => {
    expect(captureTotalCents(5000, r, 25000)).toBe(8000);
  });
  it("never exceeds authorized", () => {
    expect(captureTotalCents(5000, r, 6000)).toBe(6000);
  });
});

describe("formatCents", () => {
  it("formats", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(12345)).toBe("123.45");
  });
});

describe("one charge per physical damage (damage_key)", () => {
  const nd = (id: string, damage_key: string | undefined, over: Partial<Finding> = {}) =>
    finding({ id, damage_key, ...over });
  const price = (findings: Finding[], over: Partial<Parameters<typeof priceFindings>[0]> = {}) =>
    priceFindings({ ...base, depositCents: 0, findings, ...over });

  it("charges the same damage seen from many angles once", () => {
    const r = price(
      (["front", "top", "left", "right", "detail"] as const).map((angle, i) =>
        nd(`f${i}`, "lens-rim-dent", { angle, severity: "moderate" }),
      ),
    );
    expect(r.damageCents).toBe(12000);
    expect(r.lines.filter((l) => l.amountCents > 0)).toHaveLength(1);
    expect(r.lines.filter((l) => l.reason === "Another view of the same damage, charged once")).toHaveLength(4);
  });

  it("charges two different damages twice", () => {
    const r = price([nd("a", "lens-rim-dent", { severity: "moderate" }), nd("b", "grip-tear", { severity: "minor" })]);
    expect(r.damageCents).toBe(12000 + 3000);
  });

  it("the highest severity in the group wins; ties go to higher confidence, then first", () => {
    const sev = price([nd("a", "k1", { severity: "minor" }), nd("b", "k1", { severity: "major" }), nd("c", "k1", { severity: "moderate" })]);
    expect(sev.damageCents).toBe(35000);
    expect(sev.lines.find((l) => l.amountCents > 0)?.findingId).toBe("b");
    const conf = price([nd("a", "k1", { confidence: 0.8 }), nd("b", "k1", { confidence: 0.95 })]);
    expect(conf.lines.find((l) => l.primary)?.findingId).toBe("b");
    const stable = price([nd("a", "k1", { confidence: 0.9 }), nd("b", "k1", { confidence: 0.9 })]);
    expect(stable.lines.find((l) => l.primary)?.findingId).toBe("a");
    expect(stable.damageCents).toBe(3000);
  });

  it("a low-confidence view in a group with a confident view charges once, from the confident one", () => {
    const r = price([nd("a", "k1", { confidence: 0.5 }), nd("b", "k1", { confidence: 0.9 })]);
    expect(r.damageCents).toBe(3000);
    expect(r.lines.find((l) => l.findingId === "b")?.amountCents).toBe(3000);
    expect(r.lines.find((l) => l.findingId === "a")?.amountCents).toBe(0);
  });

  it("an unsure severe view neither raises the charge nor erases a confident lesser view", () => {
    const r = price([nd("a", "k1", { confidence: 0.5, severity: "major" }), nd("b", "k1", { confidence: 0.9, severity: "minor" })]);
    expect(r.damageCents).toBe(3000);
    expect(r.lines.find((l) => l.amountCents > 0)?.findingId).toBe("b");
  });

  it("a damage no view is sure of is not charged", () => {
    const r = price([nd("a", "k1", { confidence: 0.5, severity: "major" }), nd("b", "k1", { confidence: 0.6, severity: "minor" })]);
    expect(r.damageCents).toBe(0);
  });

  it("excluding any member of a group removes the whole damage's charge", () => {
    const fs = [nd("a", "k1", { severity: "major" }), nd("b", "k1", { severity: "minor" }), nd("c", "k2", { severity: "minor" })];
    expect(price(fs).damageCents).toBe(35000 + 3000);
    for (const id of ["a", "b"]) {
      const r = price(fs, { excludedFindingIds: [id] });
      expect(r.damageCents).toBe(3000);
      expect(r.lines.find((l) => l.findingId === "a")?.reason).toBe("Removed by the owner");
    }
    expect(price(fs, { excludedFindingIds: ["a", "b", "c"] }).damageCents).toBe(0);
  });

  it("an exclusion never raises the charge", () => {
    const fs = [nd("a", "k1", { severity: "major" }), nd("b", "k1", { severity: "minor" }), nd("c", undefined, { severity: "moderate" })];
    const full = price(fs).damageCents;
    for (const id of ["a", "b", "c"]) expect(price(fs, { excludedFindingIds: [id] }).damageCents).toBeLessThan(full);
  });

  it("findings without a key are each their own damage (old data)", () => {
    const r = price([nd("a", undefined), nd("b", undefined), nd("c", "")]);
    expect(r.damageCents).toBe(9000);
    expect(r.lines.every((l) => l.primary)).toBe(true);
  });

  it("real case: 8 views of 2 damages charge twice, capped at base", () => {
    const lens = ["front", "top", "left", "right", "detail"] as const;
    const grip = ["front", "top", "detail"] as const;
    const fs = [
      ...lens.map((angle, i) => nd(`l${i}`, "lens-rim-dent", { angle, severity: i === 4 ? "moderate" : "minor" })),
      ...grip.map((angle, i) => nd(`g${i}`, "grip-tear", { angle, severity: "minor", confidence: 0.8 + i * 0.05 })),
    ];
    const r = priceFindings({ ...base, depositCents: 20000, findings: fs });
    expect(r.damageCents).toBe(12000 + 3000);
    expect(r.lines).toHaveLength(8);
    expect(r.lines.filter((l) => l.amountCents > 0)).toHaveLength(2);
    expect(r.depositCapturedCents + r.overageCents).toBe(r.damageCents);
  });

  it("keys are matched case-insensitively and non-new-damage findings do not join a charge", () => {
    const r = price([nd("a", "Dent"), nd("b", "dent"), nd("c", "dent", { classification: "pre_existing" })]);
    expect(r.damageCents).toBe(3000);
    expect(r.lines.find((l) => l.findingId === "c")?.reason).toBe("Already present at pickup");
  });
});
