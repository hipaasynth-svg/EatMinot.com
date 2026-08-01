'use strict';
var L = require('./_lib');

// POST /api/stripe-webhook — keeps Paid status in sync (esp. cancellations).
// Configure this URL in Stripe with events: checkout.session.completed,
// customer.subscription.deleted, customer.subscription.updated.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  var raw = await L.rawBody(req);
  var secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret && !L.verifyStripeSig(raw, req.headers['stripe-signature'], secret)) {
    L.json(res, 400, { error: 'bad_signature' }); return;
  }
  var event; try { event = JSON.parse(raw); } catch (e) { L.json(res, 400, { error: 'bad_json' }); return; }
  try {
    var s = await L.getState();
    var obj = event.data && event.data.object || {};
    var changed = false;

    function byId(rid) { return rid ? L.findR(s, rid) : null; }
    function bySub(subId) { return s.restaurants.filter(function (r) { return r.stripeSubscriptionId && r.stripeSubscriptionId === subId; })[0] || null; }

    if (event.type === 'checkout.session.completed') {
      var rid = (obj.metadata && obj.metadata.restaurantId) || obj.client_reference_id;
      var r = byId(rid);
      if (r) { r.paid = true; r.claimed = true; r.stripeCustomerId = obj.customer || r.stripeCustomerId; r.stripeSubscriptionId = obj.subscription || r.stripeSubscriptionId; changed = true; }
    } else if (event.type === 'customer.subscription.deleted') {
      var r2 = bySub(obj.id) || byId(obj.metadata && obj.metadata.restaurantId);
      if (r2) { r2.paid = false; changed = true; }
    } else if (event.type === 'customer.subscription.updated') {
      var dead = ['canceled', 'unpaid', 'incomplete_expired'];
      var r3 = bySub(obj.id) || byId(obj.metadata && obj.metadata.restaurantId);
      if (r3 && dead.indexOf(obj.status) > -1) { r3.paid = false; changed = true; }
    }
    if (changed) await L.saveState(s);
    L.json(res, 200, { received: true });
  } catch (e) {
    L.json(res, 200, { received: true }); // ack anyway so Stripe doesn't retry-storm
  }
};
