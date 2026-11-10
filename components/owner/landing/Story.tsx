"use client";

import { useState, type ReactNode } from "react";
import { Stamp } from "@/components/ui";
import { useInView } from "../motion";
import styles from "./landing.module.css";
import {
  EXAMPLE_CAPTURED_CENTS,
  EXAMPLE_DEPOSIT_CENTS,
  EXAMPLE_FEE_CENTS,
  EXAMPLE_DAMAGE_CENTS,
  EXAMPLE_HELD_CENTS,
  EXAMPLE_RELEASED_CENTS,
  exampleDollars,
  exampleWhole,
} from "./MoneySplit";

function Step({
  n,
  title,
  children,
  visual,
  flip = false,
  id,
}: {
  n: number;
  title: string;
  children: ReactNode;
  visual: ReactNode;
  flip?: boolean;
  id: string;
}) {
  return (
    <div className={`${styles.step} ${flip ? styles.stepFlip : ""}`}>
      <div className={styles.stepText}>
        <span className={styles.stepNo}>Step {n} of 4</span>
        <h3 id={id} className={styles.stepTitle}>
          {title}
        </h3>
        {children}
      </div>
      <div className={styles.stepVisual}>{visual}</div>
    </div>
  );
}

/* ---------- 1. Hold ---------- */

function HoldSlip() {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  return (
    <div ref={ref} className={`ticket ${styles.slip}`}>
      <div className={styles.slipTop}>
        <span className={styles.exampleTag}>Example rental</span>
        <dl className={styles.slipRows}>
          <div>
            <dt>Rental fee, 2 days at $30</dt>
            <dd>{exampleDollars(EXAMPLE_FEE_CENTS)}</dd>
          </div>
          <div>
            <dt>Deposit</dt>
            <dd>{exampleDollars(EXAMPLE_DEPOSIT_CENTS)}</dd>
          </div>
          <div className={styles.slipSum}>
            <dt>Authorized on PayPal</dt>
            <dd>{exampleDollars(EXAMPLE_HELD_CENTS)}</dd>
          </div>
        </dl>
      </div>
      <div className="ticket-perf" aria-hidden="true" />
      <div className={`${styles.slipBottom} ${seen ? styles.slipOn : ""}`}>
        <div className={styles.hatch} aria-hidden="true" />
        <div className={styles.slipCharged}>
          <span className="font-mono text-[0.8125rem] text-ink-soft">Charged today</span>
          <strong>$0.00</strong>
        </div>
        {seen ? (
          <Stamp tone="ink" press tilt={-7} className={styles.slipStamp}>
            Held
          </Stamp>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 2. Photograph: the ghost overlay ---------- */

const ANGLES = ["Front", "Back", "Left", "Right", "Top", "Detail"];

function GhostFinder() {
  const [ghost, setGhost] = useState(45);
  return (
    <div className={styles.finderWrap}>
      <div className={styles.finder}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/samples/return-front.jpg" alt="The camera as the renter sees it at return." className={styles.finderImg} draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/samples/pickup-front.jpg"
          alt=""
          className={`${styles.finderImg} ${styles.finderGhost}`}
          style={{ opacity: ghost / 100 }}
          draggable={false}
        />
        <div className={styles.thirds} aria-hidden="true" />
        <span className={`${styles.vf} ${styles.vfTl}`} aria-hidden="true" />
        <span className={`${styles.vf} ${styles.vfTr}`} aria-hidden="true" />
        <span className={`${styles.vf} ${styles.vfBl}`} aria-hidden="true" />
        <span className={`${styles.vf} ${styles.vfBr}`} aria-hidden="true" />
        <span className={styles.vfLabel} aria-hidden="true">
          Return, front, 1 of 6
        </span>
        <span className={styles.rec} aria-hidden="true" />
      </div>
      <div className={styles.finderControls}>
        <label htmlFor="ghost-range" className={styles.finderLabel}>
          Ghost of the pickup photo
        </label>
        <input
          id="ghost-range"
          type="range"
          min={0}
          max={100}
          value={ghost}
          onChange={(e) => setGhost(Number(e.target.value))}
          aria-label="Ghost opacity"
          aria-valuetext={`${ghost} percent`}
          className={styles.range}
        />
        <output htmlFor="ghost-range" className={styles.finderPct}>
          {ghost}%
        </output>
      </div>
      <ul className={styles.angles} aria-label="The six angles">
        {ANGLES.map((a, i) => (
          <li key={a} className={i === 0 ? styles.angleOn : ""}>
            {a}
          </li>
        ))}
      </ul>
      <p className={styles.sampleNote}>AI-generated sample images. The slider is the same control the renter gets.</p>
    </div>
  );
}

/* ---------- 3. Inspect: the light table ---------- */

type Box = { x: number; y: number; w: number; h: number; kind: "new" | "prior"; label: string };
const detailBoxes: Box[] = [
  { x: 0.03, y: 0.55, w: 0.17, h: 0.11, kind: "new", label: "New" },
  { x: 0.36, y: 0.8, w: 0.17, h: 0.1, kind: "new", label: "New" },
  { x: 0.875, y: 0.745, w: 0.075, h: 0.075, kind: "prior", label: "Already there" },
];

function Pair() {
  return (
    <div className={styles.pair}>
      {(["pickup", "return"] as const).map((phase) => (
        <figure key={phase} className={styles.sheet}>
          <div className={styles.sheetImg}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/samples/${phase}-detail.jpg`}
              alt={phase === "pickup" ? "Close-up of the lens at pickup." : "Close-up of the lens at return, with a dent in the rim."}
              draggable={false}
            />
            {detailBoxes
              .filter((b) => b.kind === "prior" || phase === "return")
              .map((b, i) => (
                <span
                  key={i}
                  className={`${styles.box} ${b.kind === "prior" ? styles.boxPrior : ""}`}
                  style={{ left: `${(b.x - b.w / 2) * 100}%`, top: `${(b.y - b.h / 2) * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, ["--i" as string]: i }}
                  aria-hidden="true"
                >
                  <b>{b.label}</b>
                </span>
              ))}
          </div>
          <figcaption>{phase === "pickup" ? "Pickup, detail" : "Return, detail"}</figcaption>
        </figure>
      ))}
    </div>
  );
}

const stream = [
  { t: "Comparing pickup and return, angle by angle." },
  { t: "Found: gouge in the grip leather. New damage." },
  { t: "Found: dent in the lens rim. New damage." },
  { t: "Corner scuff is in the pickup photo too. Costs $0." },
  { t: "Done. The agent reports findings and never writes an amount.", end: true },
];

function Stream() {
  const [ref, seen] = useInView<HTMLOListElement>(0.5);
  return (
    <ol ref={ref} className={styles.stream} aria-label="What the agent reports">
      {stream.map((s, i) => (
        <li key={i} className={`${styles.streamLine} ${seen ? styles.streamOn : ""} ${s.end ? styles.streamEnd : ""}`} style={{ ["--i" as string]: i }}>
          {s.t}
        </li>
      ))}
    </ol>
  );
}

/* ---------- 4. Settle: the receipt ---------- */

function Receipt() {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const lines: { text: string; amt?: string; tone?: "damage" | "clear"; stamp?: { t: string; tone: "ink" | "damage" | "clear" } }[] = [
    { text: "Renter accepts the verdict", stamp: { t: "Agreed", tone: "ink" } },
    { text: "PayPal captures fee and damage", amt: exampleDollars(EXAMPLE_CAPTURED_CENTS), tone: "damage", stamp: { t: "Captured", tone: "damage" } },
    { text: "PayPal releases the rest", amt: exampleDollars(EXAMPLE_RELEASED_CENTS), tone: "clear", stamp: { t: "Released", tone: "clear" } },
  ];
  return (
    <div ref={ref} className={styles.receiptWrap}>
      <div className={styles.receipt}>
        <span className={styles.exampleTag}>Example rental</span>
        <ol className={styles.receiptList}>
          {lines.map((l, i) => (
            <li key={l.text} className={`${styles.receiptLine} ${seen ? styles.receiptOn : ""}`} style={{ ["--i" as string]: i }}>
              <div className={styles.receiptRow}>
                <span>{l.text}</span>
                {l.amt ? <strong className={l.tone === "damage" ? styles.amtDmg : styles.amtRel}>{l.amt}</strong> : null}
              </div>
              {seen && l.stamp ? (
                <span className={styles.receiptStamp} style={{ ["--i" as string]: i }}>
                  <Stamp tone={l.stamp.tone} press tilt={i % 2 ? 4 : -5}>
                    {l.stamp.t}
                  </Stamp>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className={styles.receiptFoot}>
          ${exampleWhole(EXAMPLE_FEE_CENTS)} fee + ${exampleWhole(EXAMPLE_DAMAGE_CENTS)} damage = ${exampleWhole(EXAMPLE_CAPTURED_CENTS)}. ${exampleWhole(EXAMPLE_HELD_CENTS)} held, ${exampleWhole(EXAMPLE_CAPTURED_CENTS)} captured, ${exampleWhole(EXAMPLE_RELEASED_CENTS)} released.
        </p>
      </div>
    </div>
  );
}

export function Story() {
  return (
    <>
      <section className={styles.paperStory} aria-labelledby="story-h">
        <div className={styles.wrap}>
          <h2 id="story-h" className={styles.storyH}>
            From hold to settled, in four steps
          </h2>
          <Step n={1} id="s1" title="Place the hold" visual={<HoldSlip />}>
            <p className={styles.stepP}>
              The renter authorizes the rental fee plus the deposit with PayPal. PayPal reserves the money on their
              account. Nothing is charged, and neither you nor Handback ever holds the funds.
            </p>
          </Step>
        </div>
      </section>

      <section className={styles.table} aria-label="Photograph and inspect">
        <div className={styles.wrap}>
          <Step n={2} id="s2" title="Photograph the item" visual={<GhostFinder />}>
            <p className={styles.stepP}>
              Six photos at pickup and six at return: front, back, left, right, top and one close detail. At return, the
              pickup photo floats over the camera view as a ghost, so the shot lines up and the comparison is fair.
            </p>
          </Step>

          <div className={styles.tableRule} aria-hidden="true" />

          <Step n={3} id="s3" title="Compare the photos" flip visual={<Pair />}>
            <p className={styles.stepP}>
              An AI agent lays each pair on the light table and lists what changed: new damage, damage that was already
              there, normal wear, or not sure. It describes the changes and leaves the pricing to code.
            </p>
            <Stream />
          </Step>
        </div>
      </section>

      <section className={styles.paperStory} aria-label="Settle">
        <div className={styles.wrap}>
          <Step n={4} id="s4" title="Settle up" visual={<Receipt />}>
            <p className={styles.stepP}>
              Code prices the new damage and a person agrees: the renter accepts, or contests it and the owner reviews. Then
              PayPal captures that amount from the hold and releases the remainder. Damage beyond the deposit is invoiced
              separately, and the renter can contest it first.
            </p>
          </Step>
        </div>
      </section>
    </>
  );
}
