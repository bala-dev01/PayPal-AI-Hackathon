"use client";

import { Stamp } from "@/components/ui";
import { CountUp, dollarsWhole, useInView } from "../motion";
import styles from "./landing.module.css";

/**
 * EXAMPLE RENTAL FIGURES (sample camera, 2 days at $30, $150 deposit). Edit these, and only these:
 * Story.tsx and the text below all read from here. Released is derived, so the split always adds up.
 */
export const EXAMPLE_HELD_CENTS = 21000; // $210 held
export const EXAMPLE_FEE_CENTS = 6000; // $60 rental fee
export const EXAMPLE_DAMAGE_CENTS = 12600; // $X damage, to be confirmed after the final run
export const EXAMPLE_RELEASED_CENTS = EXAMPLE_HELD_CENTS - EXAMPLE_FEE_CENTS - EXAMPLE_DAMAGE_CENTS; // $Y released
export const EXAMPLE_CAPTURED_CENTS = EXAMPLE_FEE_CENTS + EXAMPLE_DAMAGE_CENTS;
export const EXAMPLE_DEPOSIT_CENTS = EXAMPLE_HELD_CENTS - EXAMPLE_FEE_CENTS;

/** "$126.00" for the receipt lines. */
export const exampleDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** "126" for sentences. */
export const exampleWhole = (cents: number) => String(Math.round(cents / 100));

const HELD = EXAMPLE_HELD_CENTS;
const parts = [
  { key: "fee", cents: EXAMPLE_FEE_CENTS, label: "Rental fee", note: "2 days at $30, always charged", cls: styles.segFee },
  { key: "dmg", cents: EXAMPLE_DAMAGE_CENTS, label: "Damage captured", note: "Two new damages, priced by code", cls: styles.segDmg },
  { key: "rel", cents: EXAMPLE_RELEASED_CENTS, label: "Released", note: `What is left of the $${exampleWhole(EXAMPLE_DEPOSIT_CENTS)} deposit goes back to the renter`, cls: styles.segRel },
];

export function MoneySplit() {
  const [ref, seen] = useInView<HTMLDivElement>(0.2);
  return (
    <section className={styles.split} aria-labelledby="split-h">
      <div ref={ref} className={styles.splitInner}>
        <div className={styles.splitHead}>
          <span className={styles.exampleTag}>Example rental</span>
          <h2 id="split-h" className={styles.splitTitle}>
            <CountUp value={HELD} run={seen} format={dollarsWhole} duration={900} /> held becomes three amounts.
          </h2>
          <p className={styles.splitSub}>
            The sample camera above, rented for two days. The numbers come from a test run on PayPal&rsquo;s sandbox, so no
            real money moved.
          </p>
        </div>

        <div className={styles.barWrap}>
          <div className={styles.heldLabel}>
            <span>Held on the renter&rsquo;s PayPal</span>
            <span className="font-bold">{dollarsWhole(HELD)}</span>
          </div>
          <div className={styles.bar} role="img" aria-label={`The ${exampleWhole(HELD)} dollar hold split into ${exampleWhole(EXAMPLE_FEE_CENTS)} dollars rental fee, ${exampleWhole(EXAMPLE_DAMAGE_CENTS)} dollars damage and ${exampleWhole(EXAMPLE_RELEASED_CENTS)} dollars released.`}>
            {parts.map((p, i) => (
              <span
                key={p.key}
                className={`${styles.seg} ${p.cls} ${seen ? styles.segIn : ""}`}
                style={{ width: `${(p.cents / HELD) * 100}%`, ["--d" as string]: `${i * 380 + 300}ms` }}
              />
            ))}
          </div>
          <ul className={styles.legend}>
            {parts.map((p, i) => (
              <li key={p.key} className={styles.legendItem}>
                <span className={`${styles.swatch} ${p.cls}`} aria-hidden="true" />
                <span className={styles.legendNum}>
                  <CountUp value={p.cents} run={seen} format={dollarsWhole} delay={i * 380 + 300} duration={900} />
                </span>
                <span className={styles.legendLabel}>{p.label}</span>
                <span className={styles.legendNote}>{p.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.splitStamp} aria-hidden={!seen}>
          {seen ? (
            <Stamp tone="clear" press tilt={-6} className={styles.stampDelay}>
              Settled
            </Stamp>
          ) : null}
        </div>
      </div>
    </section>
  );
}
