'use strict';
var L = require('./_lib');

// POST /api/rate { id, stars(1-5), upvote(bool) }  -> updated public aggregates
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var stars = Math.max(1, Math.min(5, parseInt(b.stars, 10) || 0));
    if (!stars) { L.json(res, 400, { error: 'stars' }); return; }
    var upvote = !!b.upvote;
    var s = await L.getState();
    var r = L.findR(s, b.id);
    if (!r) { L.json(res, 404, { error: 'not_found' }); return; }
    r.totalRatings += 1;
    r.ratingSum += stars;
    r.ratingCount += 1;
    if (upvote) r.upvotes += 1;
    await L.saveState(s);
    L.json(res, 200, {
      id: r.id, upvotes: r.upvotes, totalRatings: r.totalRatings,
      rating: r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : 0
    });
  } catch (e) {
    L.json(res, 500, { error: 'rate_failed' });
  }
};
