'use strict';
var L = require('./_lib');

// POST /api/upgrade-confirm { sessionId } -> flips the restaurant to Paid after a
// successful Checkout return (works without the webhook secret for the happy path).
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    if (!L.stripeConfigured()) { L.json(res, 200, { error: 'not_configured' }); return; }
    var b = await L.readBody(req);
    if (!b.sessionId) { L.json(res, 400, { error: 'sessionId' }); return; }
    var out = await L.stripe('checkout/sessions/' + encodeURIComponent(b.sessionId) + '?expand[]=subscription', 'GET');
    if (!out.ok) { L.json(res, 400, { error: 'stripe' }); return; }
    var sess = out.data;
    var rid = (sess.metadata && sess.metadata.restaurantId) || sess.client_reference_id;
    var paidOk = sess.payment_status === 'paid' || sess.status === 'complete';
    if (rid && paidOk) {
      var s = await L.getState();
      var r = L.findR(s, rid);
      if (r) {
        r.paid = true; r.claimed = true;
        r.stripeCustomerId = sess.customer || r.stripeCustomerId;
        r.stripeSubscriptionId = (sess.subscription && (sess.subscription.id || sess.subscription)) || r.stripeSubscriptionId;
        await L.saveState(s);
      }
      L.json(res, 200, { ok: true, paid: true, id: parseInt(rid, 10) });
      return;
    }
    L.json(res, 200, { ok: false });
  } catch (e) {
    L.json(res, 500, { error: 'confirm_failed' });
  }
};
