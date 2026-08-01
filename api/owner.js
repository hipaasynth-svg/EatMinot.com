'use strict';
var L = require('./_lib');

// POST /api/owner { action:'login'|'update'|'photo', id, password?, token?, fields?, dataUrl? }
// Auth: 'login' checks the password and returns a signed session token.
//       'update'/'photo' accept that token (preferred) or the password.
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    var s = await L.getState();
    var r = L.findR(s, b.id);
    if (!r) { L.json(res, 404, { error: 'not_found' }); return; }

    if (b.action === 'login') {
      if (!L.verifyPw(b.password, r.password)) { L.json(res, 401, { error: 'bad_password' }); return; }
      L.json(res, 200, { ok: true, id: r.id, name: r.name, paid: r.paid, token: L.signToken(r.id) });
      return;
    }

    var authed = (b.token && L.verifyToken(b.token) === r.id) || L.verifyPw(b.password, r.password);
    if (!authed) { L.json(res, 401, { error: 'unauthorized' }); return; }

    if (b.action === 'photo') {
      if (!r.paid) { L.json(res, 403, { error: 'not_paid' }); return; }
      if (!/^data:image\//.test(b.dataUrl || '')) { L.json(res, 400, { error: 'not_image' }); return; }
      await L.kvSet(L.PHOTO_KEY(r.id), b.dataUrl);
      r.hasPhoto = true;
      await L.saveState(s);
      L.json(res, 200, { ok: true });
      return;
    }

    if (b.action === 'update') {
      var f = b.fields || {};
      if (Array.isArray(f.picks)) r.picks = f.picks.slice(0, 3).map(function (x) { return String(x || ''); });
      if (typeof f.note === 'string') r.note = f.note;
      if (typeof f.website === 'string') r.website = f.website;
      if (typeof f.reward === 'string') r.reward = f.reward;
      if (f.couponValidDays != null) r.couponValidDays = Math.max(1, parseInt(f.couponValidDays, 10) || 1);
      if (f.happyHour && typeof f.happyHour === 'object') {
        var hh = f.happyHour;
        r.happyHour = {
          enabled: !!hh.enabled,
          days: Array.isArray(hh.days) ? hh.days.map(function (d) { return parseInt(d, 10); }).filter(function (d) { return d >= 0 && d <= 6; }) : [],
          start: /^\d{1,2}:\d{2}$/.test(hh.start) ? hh.start : '15:00',
          end: /^\d{1,2}:\d{2}$/.test(hh.end) ? hh.end : '17:00',
          special: String(hh.special || '').slice(0, 60)
        };
      }
      if (typeof f.password === 'string' && f.password.trim()) r.password = L.hashPw(f.password.trim());
      await L.saveState(s);
      L.json(res, 200, { ok: true });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'owner_failed' });
  }
};
