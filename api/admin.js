'use strict';
var L = require('./_lib');

// POST /api/admin { password, action, ... }
//   action: 'list' | 'photo' {id, dataUrl} | 'removePhoto' {id}
//           | 'setFlag' {id, claimed?, paid?} | 'setPassword' {id, password}
//           | 'reset'
module.exports = async function (req, res) {
  if (req.method !== 'POST') { L.json(res, 405, { error: 'method' }); return; }
  try {
    var b = await L.readBody(req);
    if (!L.checkAdmin(b.password)) { L.json(res, 401, { error: 'bad_admin' }); return; }
    var s = await L.getState();

    if (b.action === 'list') {
      L.json(res, 200, { ok: true, restaurants: s.restaurants });
      return;
    }
    if (b.action === 'reset') {
      s = { restaurants: L.seed() };
      await L.saveState(s);
      // best-effort clear of photos
      for (var i = 1; i <= 40; i++) { try { await L.kvSet(L.PHOTO_KEY(i), ''); } catch (e) {} }
      L.json(res, 200, { ok: true });
      return;
    }

    var r = L.findR(s, b.id);
    if (!r) { L.json(res, 404, { error: 'not_found' }); return; }

    if (b.action === 'photo') {
      if (!/^data:image\//.test(b.dataUrl || '')) { L.json(res, 400, { error: 'not_image' }); return; }
      await L.kvSet(L.PHOTO_KEY(r.id), b.dataUrl);
      r.hasPhoto = true;
      await L.saveState(s);
      L.json(res, 200, { ok: true });
      return;
    }
    if (b.action === 'removePhoto') {
      await L.kvSet(L.PHOTO_KEY(r.id), '');
      r.hasPhoto = false;
      await L.saveState(s);
      L.json(res, 200, { ok: true });
      return;
    }
    if (b.action === 'setFlag') {
      if (typeof b.claimed === 'boolean') { r.claimed = b.claimed; if (!r.claimed) r.paid = false; }
      if (typeof b.paid === 'boolean') { r.paid = b.paid; if (r.paid) r.claimed = true; }
      await L.saveState(s);
      L.json(res, 200, { ok: true });
      return;
    }
    if (b.action === 'setPassword') {
      if (b.password2 && String(b.password2).trim()) { r.password = String(b.password2).trim(); await L.saveState(s); L.json(res, 200, { ok: true }); return; }
      L.json(res, 400, { error: 'password2' });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'admin_failed' });
  }
};
