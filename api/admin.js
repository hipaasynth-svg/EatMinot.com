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
      // Never expose password hashes; show the default and whether it was changed.
      var out = s.restaurants.map(function (r) {
        var o = {}; for (var k in r) o[k] = r[k];
        delete o.password;
        o.defaultPassword = L.defaultPassword(r.name);
        o.passwordChanged = !L.isDefaultPw(r.name, r.password);
        return o;
      });
      L.json(res, 200, { ok: true, restaurants: out });
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
    if (b.action === 'resetPassword') {
      r.password = L.hashPw(L.defaultPassword(r.name));
      await L.saveState(s);
      L.json(res, 200, { ok: true, defaultPassword: L.defaultPassword(r.name) });
      return;
    }
    L.json(res, 400, { error: 'action' });
  } catch (e) {
    L.json(res, 500, { error: 'admin_failed' });
  }
};
