# Handback: the deposit that settles itself

Hosted demo: https://handback-u6bl.onrender.com (PayPal sandbox, so no real money moves. It runs on Render's free plan, so the first visit after a quiet spell can take about a minute to wake up, and data resets on restart.)
Demo video: https://youtu.be/e5l9dwmJCaI

Handback is for people who lend or rent out things (cameras, tools, e-bikes, party gear, instruments) and for the people who borrow them. The renter places a PayPal hold, both sides get a photo record of the item at pickup and return, and an AI compares the photos so the hold is released, or partly captured, for an amount anyone can check line by line.

## Why the deposit problem matters

A deposit is supposed to protect the owner, but it turns into an argument the moment something looks different: was that scratch there before? Today the answer rests on memory and a few phone photos taken in a hurry. Owners lose time chasing money, and renters can lose money for marks they did not cause. Handback swaps the argument for a dated photo record and a price list anyone can read, and a person always approves before money moves.

## How it works

1. **Owner creates a rental** (`/owner/new`): item, daily rate, days (maximum 3), deposit, replacement value. They get a link for the renter.
2. **Renter places a hold** (`/r/[id]`): PayPal authorizes the rental fee plus the deposit. Nothing is charged yet.
3. **Pickup photos**: six guided angles (front, back, left, right, top, close detail). The camera gives per-shot feedback, with file upload as a fallback.
4. **Return photos**: the same six angles, with the pickup photo shown as a ghost overlay so each shot lines up.
5. **Inspection**: a Claude agent compares each pair of photos and reports findings, each labelled new damage, pre-existing, normal wear or uncertain.
6. **Verdict and settlement**: code prices the findings. The renter accepts, or contests with a note and the owner reviews (the owner can only lower the charge). On approval the rental fee and any damage within the deposit are captured, and the unused deposit is released. Damage above the deposit becomes a PayPal invoice, which the renter could contest first.
7. **Evidence record** (`/r/[id]/record`): a printable record with photos, findings, pricing and PayPal references.
8. **Owner console** (`/owner`): an AG Grid ledger of rentals, holds, captures and releases.

## How PayPal is used

| Step | PayPal API |
|---|---|
| Place the hold | Orders v2, `intent: AUTHORIZE`, then authorize the approved order |
| Take money | Partial capture of the authorization with `final_capture: true`, using `PayPal-Request-Id` so retries are idempotent |
| Release the rest | The capture is sent with `final_capture: true`, which releases whatever is left of the hold. A rental with nothing to charge voids the authorization instead |
| Owner releases a stranded hold | Void the whole authorization (`POST /api/rentals/[id]/release`, owner token only). Allowed while the rental is held, picked up or returned (not while an inspection is running or after settlement starts), ends the rental as `released`, and can never capture |
| Damage above the deposit | Agent Toolkit (`@paypal/agent-toolkit`): `create_invoice` and `send_invoice` |
| Read order state | Agent Toolkit `get_order` (read-only; tools that move money are not exposed to the AI) |
| Record PayPal events | Webhooks, verified with PayPal's signature verification endpoint. Verified events for voided authorizations, completed captures and new disputes are recorded and displayed in the rental's timeline. They do not change a rental's status or move money |

Checkout uses the PayPal JS SDK (buttons) in the browser. The client secret never leaves the server.

## How Claude is used

- **Models**: through the official `@anthropic-ai/sdk`. Both the photo quality checks and the inspection use Claude Haiku 5.5 (`claude-haiku-5-5`), with prompt caching on the inspection. The inspection model is one constant (`MODEL`) in `lib/ai/client.ts`, and accuracy varies by model.
- **Vision**: Haiku checks photo quality as each photo is taken, and compares pickup against return photos angle by angle for the inspection.
- **Tool use**: the inspection agent returns structured findings through tools. The tools it holds cannot capture funds.
- **What it never does**: set an amount. The model returns findings only; a plain, unit-tested function in `lib/pricing.ts` turns findings into integer cents.

## Sponsor tools actually used

- **AG Grid**: the owner rentals ledger (`/owner`).
- **Render**: deployable to Render with the included `render.yaml`.
- **Channel3**: replacement-price lookup on the new-rental form. Used only when `CHANNEL3_API_KEY` is set; otherwise the owner enters the value.

Bryntum is not used.

## Disputes

- **Before capture, the renter can contest in Handback.** Contesting captures nothing. The owner can only lower the charge, and the owner has the final decision inside Handback.
- **After capture, the renter keeps their normal PayPal rights** and can open a dispute with PayPal. PayPal decides those disputes, not Handback.
- **Handback does not send evidence to PayPal automatically.** When PayPal reports a new dispute by webhook (`CUSTOMER.DISPUTE.CREATED`), the rental shows a "Dispute opened in PayPal" banner with the date and dispute ID. The owner responds in PayPal's Resolution Center and can use the rental's evidence record (`/r/[id]/record`) to support the answer.
- The webhook does not change a rental's status or move money. `GET /api/rentals/[id]` exposes `paypalDispute` (`openedAt`, `disputeId`, `status`, or `null`) derived from the recorded event. `status` is whatever PayPal sent.

## Sample data

The sample rentals in the owner console are labelled as samples and cannot take a PayPal hold. Any sample photos bundled with the project are AI-generated images and don't show real items.

## Lost renter key

The renter's key to a rental is saved in the browser that placed the hold. The hold page tells the renter to continue in that browser. If the key is lost, the owner can release the whole hold from the rental page until the inspection starts (including a rental left at "returned" after the AI declined or failed); nothing is charged.

## Fairness rules

The server enforces these in code:

- The AI describes what it sees, and code decides the amount. No number from the model is used as money.
- Damage that was already there at pickup, normal wear, and any finding under 75% confidence cost nothing, and the report says why.
- No money moves without a person: the renter accepts, or the owner approves after a contest. The owner can only reduce a charge.
- Capture can never exceed the authorized amount. PayPal requests are idempotent, and a failed settlement can be retried without capturing twice.
- Damage beyond the deposit is invoiced separately, and the renter can contest first.

One rule is only an instruction with no guarantee behind it: photos are treated as untrusted input and the AI is told to ignore any text in them (for example a sign saying "no damage"). Because a person approves every charge and code sets the amount, a misled model cannot move money on its own.

## Setup

Requirements: Node 24.

```bash
git clone <this repository>
cd PayPal-AI-Hackathon
npm ci
cp .env.example .env     # on Windows: copy .env.example .env
```

Fill in `.env`:

| Variable | Needed | Notes |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Yes | From a PayPal sandbox app |
| `PAYPAL_ENVIRONMENT` | Yes | `SANDBOX` |
| `PAYPAL_WEBHOOK_ID` | For webhooks | Webhook ID of the same sandbox app |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `CHANNEL3_API_KEY` | Optional | Enables real replacement prices |
| `APP_ORIGIN` | Optional | Validated as a URL and defaults to `http://localhost:3000`, but no code reads it yet. Use it as a note of your public URL when registering the PayPal webhook |
| `DEMO_DAILY_INSPECTION_LIMIT` | Optional | Daily cap on AI inspections (default 10) |
| `DEMO_DAILY_PHOTO_CHECK_LIMIT` | Optional | Daily cap on per-photo Claude quality checks (default 400). Past it, photos are accepted with neutral feedback |
| `HANDBACK_DATA_DIR` | Optional | Where the SQLite database and photos are stored. Defaults to `./data` |
| `TRUSTED_PROXY_HOPS` | Optional | Number of your own proxies in front of the app, counted from the right of `X-Forwarded-For`, used to find the client IP for rate limits (default 1) |

### Create PayPal sandbox accounts

1. Sign in at developer.paypal.com and open **Apps & Credentials** with **Sandbox** selected. Create an app and copy its client ID and secret into `.env`.
2. Open **Testing Tools > Sandbox Accounts**. Create (or use the default) **Personal** account for the renter and a **Business** account for the merchant. Choose **United States** as the country for both, so USD holds work.
3. Optional, for webhooks: add a webhook to the app pointing at `<APP_ORIGIN>/api/webhooks/paypal` (it must be a public URL, so this applies to a deployed copy) and copy its ID into `PAYPAL_WEBHOOK_ID`.

### Run

```bash
npm run dev     # http://localhost:3000
npm test        # unit tests
```

Data (SQLite and photos) is stored under `data/`, created on first run.

## Sandbox test flow

1. Open `/owner/new` and create a rental: for example a camera, $20/day, 2 days, $100 deposit, $600 replacement value. Copy the renter link.
2. Open the renter link in the browser you will keep using (the renter's session is tied to the browser that places the hold). Tick the terms box and pay with the sandbox Personal account. Hold placed, nothing charged.
3. Take the six pickup photos (camera or upload) and finish pickup.
4. Change the item visibly (a scratch, a dent, a missing part), then take the six return photos, lining them up with the ghost overlay.
5. Watch the inspection stream, then review the verdict: findings, the code-computed price, and what will be captured and released.
6. Accept to settle, or contest with a note, then approve as the owner from `/owner/rentals/[id]` in the browser that created the rental.
7. Open the evidence record, and check `/owner` for the updated ledger. In the sandbox account activity you can see the capture and the released remainder.

Sample rentals in the console are labelled as samples and are view-only.

## Known limitations

- **3-day hold window.** PayPal honors an authorization for 3 days, so rentals are limited to 3 days. Longer rentals would need reauthorization, which is not built.
- **Free hosting resets data.** On Render's free tier the disk is not persistent, so rentals and photos are wiped when the service restarts or redeploys. Fine for a demo, but don't use it for real rentals.
- **The AI can be wrong.** That is why a person approves every charge, low-confidence findings cost nothing, and the renter can contest.
- **Sandbox only.** Payments run against PayPal's sandbox. No real money moves.
- **Renter session is browser-bound.** A renter continues the rental from the browser that placed the hold; the owner approves from the browser that created the rental.
- Bryntum is not used.

## License

MIT. See `LICENSE`.
