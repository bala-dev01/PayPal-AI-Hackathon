import { LinkButton } from "../link-button";
import styles from "./landing.module.css";

const roles = [
  {
    who: "PayPal",
    does: "Holds the money, then captures or releases it",
    body: "Authorizes the fee plus deposit, captures the agreed amount, releases the rest, and invoices anything above the hold. Handback never touches the funds.",
    can: "Moves the money",
  },
  {
    who: "The AI",
    does: "Looks at photos",
    body: "Compares each pickup and return pair and reports what changed, with a label and how sure it is.",
    can: "Cannot set a price or move money",
  },
  {
    who: "Code",
    does: "Prices the findings",
    body: "A plain, tested function turns findings into cents, and caps the capture at what the renter authorized.",
    can: "Sets every amount",
  },
  {
    who: "People",
    does: "Say yes",
    body: "The renter accepts or contests. After a contest the owner reviews, and can only lower the charge.",
    can: "Approve every charge",
  },
];

const rules = [
  {
    head: "The AI looks, code sets the price.",
    body: "The model only describes what it sees in the photos. A plain, tested pricing function turns findings into cents. No number from the model is ever used as an amount.",
  },
  {
    head: "The benefit of the doubt goes to the renter.",
    body: "Damage already there at pickup, normal wear, and anything the model is under 75% sure about costs nothing, and the report says why.",
  },
  {
    head: "Writing in a photo counts for nothing.",
    body: "The AI is instructed to ignore any writing in the frame, such as a sign reading “no damage”. That part is only an instruction, with no guarantee behind it. What code does enforce: the model cannot set an amount, cannot capture money, and a person must approve.",
  },
  {
    head: "A person approves every charge.",
    body: "The renter accepts the verdict, or contests it with a note and the owner reviews it. The server enforces that approval, and caps capture at what the renter authorized.",
  },
];

export function Roles() {
  return (
    <section className={styles.roles} aria-labelledby="roles-h">
      <div className={styles.wrap}>
        <h2 id="roles-h" className={styles.sectionH}>
          Who does what
        </h2>
        <div className={styles.roleGrid} role="list">
          {roles.map((r) => (
            <div key={r.who} className={styles.role} role="listitem">
              <h3 className={styles.roleWho}>{r.who}</h3>
              <p className={styles.roleDoes}>{r.does}</p>
              <p className={styles.roleBody}>{r.body}</p>
              <p className={styles.roleCan}>{r.can}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Rules() {
  return (
    <section className={styles.rules} aria-labelledby="fair-h">
      <div className={styles.wrap}>
        <h2 id="fair-h" className={styles.sectionH}>
          Fair to whoever holds the item, and to whoever owns it
        </h2>
        <ul className={styles.ruleList}>
          {rules.map((r) => (
            <li key={r.head} className={styles.rule}>
              <h3 className={styles.ruleHead}>{r.head}</h3>
              <p className={styles.ruleBody}>{r.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Closer() {
  return (
    <>
      <section className={styles.closer} aria-labelledby="start-h">
        <div className={`${styles.wrap} ${styles.closerInner}`}>
          <div>
            <h2 id="start-h" className={styles.closerH}>
              Lend something and send one link.
            </h2>
            <p className={styles.closerP}>
              Enter the item, rate and deposit. You get a link for the renter, and the console tracks every hold.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <LinkButton href="/owner/new" variant="paper">
              Create a rental
            </LinkButton>
            <LinkButton href="/owner" variant="outlinePaper">
              Open the console
            </LinkButton>
          </div>
        </div>
      </section>
      <footer className={styles.wrap}>
        <p className={styles.foot}>
          Made for the PayPal AI hackathon. Payments run on PayPal&rsquo;s sandbox. Photos on this page are AI-generated
          samples of a fictional camera, and the amounts are labelled example figures from a sandbox test. Sample rows in
          the console are labelled as samples.
        </p>
      </footer>
    </>
  );
}
