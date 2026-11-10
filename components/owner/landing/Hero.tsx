"use client";

import { useState } from "react";
import { Stamp } from "@/components/ui";
import { LinkButton } from "../link-button";
import { CompareSlider, MARKS } from "./CompareSlider";
import styles from "./landing.module.css";

const findings = [
  { id: "grip", title: "Gouge in the grip leather", tag: "New damage", charge: true },
  { id: "rim", title: "Dent in the lens rim", tag: "New damage", charge: true },
  { id: "scuff", title: "Scuff on the bottom corner", tag: "Already there at pickup", charge: false },
];

export function Hero() {
  const [active, setActive] = useState<string | null>(null);
  return (
    <section className={styles.hero} aria-labelledby="hero-h">
      <div className={styles.heroTop}>
        <h1 id="hero-h" className={styles.h1}>
          The deposit that settles itself.
        </h1>
        <div className={styles.heroCopy}>
          <p className={styles.lede}>
            The deposit waits as a PayPal hold. An AI agent compares the photos from pickup and return, and code prices
            whatever changed.
          </p>
          <div className="flex flex-wrap gap-4">
            <LinkButton href="/owner/new">Create a rental</LinkButton>
            <LinkButton href="/owner" variant="ghost">
              Open the console
            </LinkButton>
          </div>
        </div>
      </div>

      <div className={styles.heroStage}>
        <CompareSlider active={active} onActive={setActive} />

        <aside className={`ticket ${styles.tag}`} aria-label="What the inspection found">
          <div className={styles.tagHead}>
            <span className="font-mono text-[0.8125rem] text-ink-soft">Condition report</span>
            <span className="font-mono text-[0.8125rem] text-ink-soft">Sample camera</span>
          </div>
          <div className={styles.tagBody}>
            <p className={styles.tagLead}>Two new damages, plus one scuff that was already there.</p>
            <ul className={styles.findList}>
              {findings.map((f, i) => {
                const m = MARKS.find((x) => x.id === f.id)!;
                return (
                  <li
                    key={f.id}
                    className={`${styles.find} ${active === f.id ? styles.findActive : ""}`}
                    onMouseEnter={() => setActive(f.id)}
                    onMouseLeave={() => setActive(null)}
                    style={{ ["--i" as string]: i }}
                  >
                    <span className={`${styles.pin} ${m.kind === "prior" ? styles.pinPrior : ""}`} aria-hidden="true" />
                    <span className={styles.findText}>
                      <span className={styles.findTitle}>{f.title}</span>
                      <span className={f.charge ? styles.findCharge : styles.findFree}>
                        {f.tag}
                        {f.charge ? ", charged" : ", costs $0"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="ticket-perf" aria-hidden="true" />
          <div className={styles.tagStub}>
            <p className="m-0 font-mono text-[0.8125rem] leading-snug text-ink-soft">
              The AI lists what it sees, and code turns the new damage into a price.
            </p>
            <Stamp tone="damage" press tilt={-5} className={styles.heroStamp}>
              2 new
            </Stamp>
          </div>
        </aside>
      </div>
    </section>
  );
}
