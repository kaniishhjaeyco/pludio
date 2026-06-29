// Creates a Stripe Checkout Session for the Pludio Premium plan.
//
// The user's email is taken from the request (query param `?email=` on GET,
// or JSON body `{ "email": "..." }` on POST). The subscribe page passes the
// email it reads from its own URL parameter.
//
// Runs as a Vercel serverless function at /api/stripe/create-checkout-session.

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pludio Premium plan price IDs, keyed by billing interval.
const PRICE_IDS = {
  monthly: 'price_1TnbAGHNXHGsdb3rlxg8BD7V',
  yearly: 'price_1TnbBAHNXHGsdb3rQq2pNmle',
};

function getOrigin(req) {
  // Prefer an explicit env override so success/cancel URLs are stable in prod.
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email =
    (req.query && req.query.email) ||
    (req.body && req.body.email) ||
    null;

  if (!email) {
    return res.status(400).json({ error: 'Missing email parameter.' });
  }

  // Plan selection (defaults to monthly for backwards compatibility).
  const plan =
    (req.query && req.query.plan) ||
    (req.body && req.body.plan) ||
    'monthly';
  const priceId = PRICE_IDS[plan];

  if (!priceId) {
    return res.status(400).json({ error: 'Invalid plan.' });
  }

  try {
    const origin = getOrigin(req);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe.html?email=${encodeURIComponent(email)}`,
      // Make the email available on the subscription too, so webhook events
      // that only carry a customer id can still be matched back to a user.
      subscription_data: { metadata: { email } },
      metadata: { email },
    });

    // GET (direct link / form submit) → redirect straight to Stripe.
    // POST (fetch) → return the URL so the client can redirect itself.
    if (req.method === 'GET') {
      res.writeHead(303, { Location: session.url });
      return res.end();
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return res.status(500).json({ error: 'Unable to start checkout. Please try again.' });
  }
};
