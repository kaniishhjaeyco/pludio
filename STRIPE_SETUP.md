# Stripe Subscription Setup

Pludio is a static site deployed on **Vercel**. The Stripe integration uses two
Vercel serverless functions under `api/stripe/`. No build step is required —
Vercel serves the HTML files directly and runs the `api/` functions on demand.

## Files

| Path | Purpose |
| --- | --- |
| `api/stripe/create-checkout-session.js` | Creates a Checkout Session for the Premium plan using the email passed from `/subscribe?email=...`. |
| `api/stripe/webhook.js` | Handles `checkout.session.completed`, `customer.subscription.deleted`, and `invoice.payment_failed`, and updates Supabase. |
| `subscribe.html` | Reads `email` from its URL and wires the "Get Started" buttons to the checkout endpoint. |
| `success.html` | Post-payment page telling the user to return to the app. |

## Environment variables

Set these in the Vercel project (and locally in `.env` — see `.env.example`):

- `STRIPE_SECRET_KEY` — test-mode secret key (`sk_test_...`)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — test-mode publishable key (`pk_test_...`)
- `STRIPE_WEBHOOK_SECRET` — signing secret for the webhook endpoint (`whsec_...`)
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase **service role** key (server-side only)
- `SUPABASE_TABLE` — optional; defaults to `users`

> The publishable key is not needed by the current flow (we redirect to the
> Stripe-hosted Checkout URL), but it is included per the spec for future use.

## Supabase table

The webhook updates a row matched by `email` and expects these columns:

- `email` (text)
- `is_subscribed` (boolean)
- `subscription_end_date` (timestamptz, nullable)

## Webhook configuration

In the Stripe Dashboard (test mode) → Developers → Webhooks, add an endpoint:

```
https://<your-domain>/api/stripe/webhook
```

Subscribe to: `checkout.session.completed`, `customer.subscription.deleted`,
`invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Local testing

```bash
npm install
vercel dev                       # serves the site + /api functions
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Open `http://localhost:3000/subscribe?email=test@example.com`, click **Get
Started**, and pay with test card `4242 4242 4242 4242`.
