// Stripe webhook handler for Pludio subscriptions.
//
// Runs as a Vercel serverless function at /api/stripe/webhook.
// Listens for:
//   - checkout.session.completed     → is_subscribed = true (+ subscription_end_date)
//   - customer.subscription.deleted  → is_subscribed = false
//   - invoice.payment_failed         → is_subscribed = false
//
// The raw request body is required to verify the Stripe signature, so the
// built-in body parser is disabled below.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Supabase table that holds the per-user subscription flags.
// Override with SUPABASE_TABLE if your table is named differently.
const TABLE = process.env.SUPABASE_TABLE || 'users';

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) =>
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    );
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Updates the subscription columns for the row matching `email`.
async function updateSubscriptionByEmail(email, fields) {
  if (!email) {
    console.warn('Webhook event had no email; skipping Supabase update.');
    return;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .update(fields)
    .eq('email', email)
    .select('email');

  if (error) throw error;
  if (!data || data.length === 0) {
    console.warn(`No Supabase row found for email "${email}".`);
  }
}

// Falls back to the customer record when an event only carries a customer id.
async function emailFromCustomer(customerId) {
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !customer.deleted) return customer.email || null;
  } catch (err) {
    console.error('Failed to retrieve customer:', err.message);
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method not allowed');
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email =
          session.customer_email ||
          (session.customer_details && session.customer_details.email) ||
          (session.metadata && session.metadata.email) ||
          (await emailFromCustomer(session.customer));

        let subscriptionEndDate = null;
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );
          if (subscription.current_period_end) {
            subscriptionEndDate = new Date(
              subscription.current_period_end * 1000
            ).toISOString();
          }
        }

        await updateSubscriptionByEmail(email, {
          is_subscribed: true,
          subscription_end_date: subscriptionEndDate,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const email =
          (subscription.metadata && subscription.metadata.email) ||
          (await emailFromCustomer(subscription.customer));

        await updateSubscriptionByEmail(email, { is_subscribed: false });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const email =
          invoice.customer_email ||
          (await emailFromCustomer(invoice.customer));

        await updateSubscriptionByEmail(email, { is_subscribed: false });
        break;
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    // 500 tells Stripe to retry later.
    return res.status(500).send(`Handler Error: ${err.message}`);
  }
};

// Vercel: disable automatic body parsing so we can read the raw bytes needed
// for Stripe signature verification. Set after the handler assignment above,
// otherwise reassigning `module.exports` would drop this property.
module.exports.config = { api: { bodyParser: false } };
