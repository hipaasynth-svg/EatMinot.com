/* EatMinot client store.
   Two modes, chosen at load:
     - "server": a shared database is attached (GET /api/state reports persistent:true).
       Public metrics + owner/admin content live on the server, shared across all devices.
     - "local":  no database attached yet — falls back to this browser's localStorage so the
       site still works. Switches to "server" automatically once storage is provisioned.
   Punch-card progress and coupons are always per-device (anonymous), matching the
   privacy rules ("clearing cache can lose punch progress"). */
(function (global) {
  'use strict';

  var LKEY = 'eatminot_local_v3';     // local-mode shared-ish data (this browser)
  var DKEY = 'eatminot_device_v1';    // per-device punches/coupons/ratedAt
  var AKEY = 'eatminot_admin_v1';     // local-mode admin password
  var RATE_WINDOW_MS = 86400000;
  var DEFAULT_ADMIN = 'minot-admin';

  var RAW = [
    ["The Starving Rooster", "30 1st St NE, Minot, ND 58703", "Mon-Thu 11am-10pm, Fri-Sat 11am-11pm, Sun 11am-9pm"],
    ["Ebeneezer's Eatery & Irish Pub", "300 E Central Ave, Minot, ND 58701", "Daily 7am-1am (kitchen closes ~10pm)"],
    ["Bone's BBQ Smokehouse & Grill", "437 N Broadway, Minot, ND 58703", "Daily ~11am-10/11pm"],
    ["Ironhorse Kitchen + Bar", "21 E Central Ave, Minot, ND 58701", "Mon-Thu 11am-11pm, Fri-Sat 11am-12am, Sun Closed"],
    ["Charlie's Main Street Cafe", "113 Main St S, Minot, ND 58701", "Mon-Sat 7am-2pm, Sun 8am-2pm"],
    ["Kroll's Diner", "1221 20th Ave SE, Minot, ND 58701", "Daily 7am-8:45pm"],
    ["Little Blue Elephant", "22 S Main St, Minot, ND 58701", "Verify hours"],
    ["Basecamp Indian Kitchen", "1425 24th Ave SW, Minot, ND 58701", "Mon, Wed-Sun 11am-9pm, Tue Closed"],
    ["Prairie Sky Breads", "3 1st St SE, Minot, ND 58701", "Morning-afternoon bakery hours"],
    ["Magic City Hoagies & Sweets", "123 Main St S, Minot, ND 58701", "Verify hours"],
    ["Minot's Daily Bread", "1500 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Badlands Restaurant and Bar", "1400 31st Ave SW, Minot, ND 58701", "Verify hours"],
    ["The Depot and Baggage Claim", "15 Main St N, Minot, ND 58703", "Tue-Thu 11am-9pm, Fri 11am-11pm, Sat 10am-11pm, Sun 10am-2pm, Mon Closed"],
    ["Oishii Ramen", "Downtown Minot", "Verify hours"],
    ["Don Tapatío", "1445 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Mi Mexico Restaurant", "3816 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Baan Rao Thai Restaurant", "Minot, ND", "Verify hours"],
    ["Ziggy's Caribbean Cuisine", "201 University Ave W, Minot, ND 58703", "Verify hours"],
    ["China Star", "1631 S Broadway, Minot, ND 58701", "Verify hours"],
    ["JL Beers", "2001 22nd Ave SW, Minot, ND 58701", "Verify hours"],
    ["Sammy's Pizza", "400 N Broadway, Minot, ND 58703", "Verify hours"],
    ["Planet Pizza", "220 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Nite Train Pizza", "515 20th Ave SE, Minot, ND 58701", "Verify hours"],
    ["Uncle Maddio's Pizza Joint", "3310 16th St SW, Minot, ND 58701", "Verify hours"],
    ["Taco Feliz", "1535 S Broadway, Minot, ND 58701", "Verify hours"],
    ["El Azteca", "2035 N Broadway, Minot, ND 58703", "Verify hours"],
    ["Homesteaders Restaurant", "2501 Elk Dr, Minot, ND 58701", "Mon-Sat 6:30am-8pm, Sun 7am-8pm"],
    ["Off The Vine", "15 Main St S, Minot, ND 58701", "Verify hours"],
    ["Souris River Brewing", "32 3rd St NE, Minot, ND 58703", "Verify hours"],
    ["Broadway Bean and Bagel", "Minot, ND", "Verify hours"],
    ["Do Eat", "2400 10th St SW #522 (Dakota Square Mall), Minot, ND 58701", "Sun-Thu 11am-9:30pm, Fri-Sat 11am-10pm"],
    ["Try Thai Food", "1524 S Broadway #4A, Minot, ND 58701", "Mon-Sat 11am-9pm, Sun Closed"],
    ["Beowulf Craft Kitchen & Lounge", "1912 Valley Bluffs Dr, Minot, ND 58701", "Mon-Thu 11am-10pm, Fri-Sat 9:30am-10pm, Sun 9:30am-8pm"],
    ["El Arepazo", "2251 36th Ave SW, Minot, ND 58701", "Mon-Sat 10am-7pm, Sun Closed"],
    ["Prairie Pit BBQ", "1809 S Broadway (Enerbase), Minot, ND 58701", "Daily 11am-8pm"],
    ["The Bunker Bar and Grill", "Old Ground Round location, Minot, ND", "Sun-Thu 11am-10pm, Fri-Sat 11am-11pm"],
    ["El Reparo Mexican Grill & Cantina", "1735 S Broadway, Minot, ND 58701", "Mon-Sat 11am-9pm, Sun 11am-8pm"],
    ["Thaihot 2 / Thai Hot", "122 Main St S, Minot, ND 58701", "Mon-Sat ~11am-9/9:30pm (Sun often closed - verify)"],
    ["Zorbas Mediterranean Restaurant", "1412 2nd Ave SW, Minot, ND 58701", "Most days 11am-9pm (Tue sometimes closed - verify)"],
    ["Primo", "1505 N Broadway (Grand International), Minot, ND 58703", "Breakfast & dinner hours – verify (often closed Mon)"],
    ["Paradiso Mexican Restaurant", "1445 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Joe's Italian Restaurant", "7 1st St SE, Minot, ND 58701", "Verify hours"],
    ["Lucky Bowl", "122 Main St S, Minot, ND 58701", "Verify hours"],
    ["Rocky's Burgers Franks & Fries", "623 N Broadway, Minot, ND 58703", "Verify hours"],
    ["Fun On A Bun", "101 Main St S, Minot, ND 58701", "Verify hours"],
    ["Poppa's Place", "510 Central Ave E, Minot, ND 58701", "Verify hours"],
    ["10 North Main", "10 Main St N, Minot, ND 58703", "Verify hours"],
    ["N.D. Asia Restaurant & Lounge", "3400 16th St SW, Minot, ND 58701", "Verify hours"],
    ["Spicy Pie", "1100 N Broadway #100, Minot, ND 58703", "Verify hours"],
    ["Happy Joe's Pizza & Ice Cream", "Minot, ND", "Verify hours"],
    ["Marco's Pizza", "Multiple locations, Minot, ND", "Verify hours"]
  ];

  function slug(n) { return String(n).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function defaultPassword(n) { return slug(n) + '26'; }
  function fmtNum(n) {
    n = Math.round(n || 0);
    if (n >= 1000) { var k = n / 1000; return (n >= 10000 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace(/\.0$/, '') + 'k'; }
    return String(n);
  }
  function seedList() {
    return RAW.map(function (row, i) {
      var id = i + 1, name = row[0], claimed = id === 1;
      return {
        id: id, name: name, address: row[1], hours: row[2],
        claimed: claimed, paid: claimed, password: defaultPassword(name),
        photo: null, hasPhoto: false,
        pickPhotos: [null, null, null], hasPickPhoto: [false, false, false],
        upvotes: 0, ratingSum: 0, ratingCount: 0, totalRatings: 0, rating: 0,
        picks: claimed ? ['Fried Chicken Sandwich', 'Loaded Tots', 'House IPA'] : ['', '', ''],
        note: claimed ? 'Family-owned since day one — thanks for supporting local, Minot!' : '',
        website: claimed ? 'starvingrooster.com' : '',
        reward: 'Free item on your 10th punch', couponValidDays: 14,
        happyHour: claimed
          ? { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '15:00', end: '17:00', special: 'Half-price apps' }
          : { enabled: false, days: [1, 2, 3, 4, 5], start: '15:00', end: '17:00', special: '' }
      };
    });
  }

  /* ---------- time / display helpers ---------- */
  function toMin(t) { if (!t || t.indexOf(':') < 0) return null; var p = t.split(':'), h = +p[0], m = +p[1]; return isNaN(h) || isNaN(m) ? null : h * 60 + m; }
  function isHappyHourNow(r, when) {
    var hh = r && r.happyHour; if (!hh || !hh.enabled) return false;
    var now = when || new Date();
    if (Array.isArray(hh.days) && hh.days.length && hh.days.indexOf(now.getDay()) < 0) return false;
    var cur = now.getHours() * 60 + now.getMinutes(), s = toMin(hh.start), e = toMin(hh.end);
    if (s == null || e == null) return false;
    return e <= s ? (cur >= s || cur < e) : (cur >= s && cur < e);
  }
  function to12h(t) { var m = toMin(t); if (m == null) return t || ''; var h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am', h12 = h % 12 || 12; return h12 + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '') + ap; }

  function withRating(r) { r.rating = r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : 0; return r; }

  /* ---------- device (per-browser, anonymous) ---------- */
  function loadDevice() {
    var d; try { d = JSON.parse(global.localStorage.getItem(DKEY)); } catch (e) { d = null; }
    if (!d || !d.deviceId) d = { deviceId: 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36), perRest: {} };
    if (!d.perRest) d.perRest = {};
    return d;
  }
  function saveDevice(d) { try { global.localStorage.setItem(DKEY, JSON.stringify(d)); } catch (e) {} }
  function deviceRec(id) { var d = loadDevice(); return d.perRest[id] || { done: 0, total: 10, coupon: null, ratedAt: 0 }; }
  function ratedRecently(id) { var rec = deviceRec(id); return !!(rec.ratedAt && Date.now() - rec.ratedAt < RATE_WINDOW_MS); }
  // Apply a completed rating to this device's punch card; returns the record.
  function punch(id, couponValidDays, reward) {
    var d = loadDevice(); var rec = d.perRest[id] || { done: 0, total: 10, coupon: null, ratedAt: 0 };
    rec.ratedAt = Date.now();
    var nd = rec.done + 1;
    if (nd >= (rec.total || 10)) {
      rec.done = 0;
      var days = couponValidDays || 14;
      rec.coupon = { code: 'EAT-' + Math.random().toString(36).slice(2, 7).toUpperCase(), issuedAt: Date.now(), expiresAt: Date.now() + days * 86400000, reward: reward || 'Reward earned!' };
    } else { rec.done = nd; }
    d.perRest[id] = rec; saveDevice(d); return rec;
  }

  /* ---------- local-mode persistence ---------- */
  function loadLocal() {
    var data; try { data = JSON.parse(global.localStorage.getItem(LKEY)); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.restaurants) || !data.restaurants.length) { data = { restaurants: seedList() }; saveLocal(data); }
    // Forward-fill fields added after a browser already cached older local data.
    data.restaurants.forEach(function (r) {
      if (!Array.isArray(r.pickPhotos) || r.pickPhotos.length !== 3) r.pickPhotos = [null, null, null];
      if (!Array.isArray(r.hasPickPhoto) || r.hasPickPhoto.length !== 3) r.hasPickPhoto = [false, false, false];
    });
    data.restaurants.forEach(withRating);
    return data;
  }
  function saveLocal(d) { try { global.localStorage.setItem(LKEY, JSON.stringify(d)); return true; } catch (e) { return false; } }
  function localFind(d, id) { id = parseInt(id, 10); return d.restaurants.filter(function (r) { return r.id === id; })[0] || null; }

  /* ---------- image helper ---------- */
  function fileToDataUrl(file, maxW, q) {
    maxW = maxW || 900; q = q || 0.72;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('not image')); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width), w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/jpeg', q)); } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('load failed')); };
      img.src = url;
    });
  }

  /* ---------- network ---------- */
  function api(path, method, body) {
    return fetch('/api/' + path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }

  /* ---------- store state ---------- */
  var mode = 'local';         // 'server' | 'local'
  var cache = [];             // restaurants (public shape)
  var photoCache = {};        // id -> dataURL | null | undefined(unfetched)

  function init() {
    return api('state').then(function (res) {
      if (res.ok && res.data && res.data.persistent) {
        mode = 'server';
        cache = res.data.restaurants.map(withRating);
      } else { throw new Error('no server'); }
    }).catch(function () {
      mode = 'local';
      cache = loadLocal().restaurants.map(withRating);
    }).then(function () { return { mode: mode, restaurants: cache }; });
  }

  function refresh() {
    if (mode === 'server') return api('state').then(function (res) { if (res.ok) cache = res.data.restaurants.map(withRating); return cache; });
    cache = loadLocal().restaurants.map(withRating); return Promise.resolve(cache);
  }

  function list() { return cache; }
  function get(id) { id = parseInt(id, 10); return cache.filter(function (r) { return r.id === id; })[0] || null; }

  function getPhoto(id) {
    if (photoCache[id] !== undefined) return Promise.resolve(photoCache[id]);
    if (mode === 'server') {
      var r = get(id);
      if (r && !r.hasPhoto) { photoCache[id] = null; return Promise.resolve(null); }
      return api('photo?id=' + id).then(function (res) { photoCache[id] = (res.ok && res.data.photo) || null; return photoCache[id]; }).catch(function () { return null; });
    }
    var lr = localFind(loadLocal(), id); photoCache[id] = lr ? (lr.photo || null) : null; return Promise.resolve(photoCache[id]);
  }
  function clearPhoto(id) { delete photoCache[id]; }

  var pickPhotoCache = {}; // "id:i" -> dataURL | null | undefined(unfetched)
  function getPickPhoto(id, i) {
    var k = id + ':' + i;
    if (pickPhotoCache[k] !== undefined) return Promise.resolve(pickPhotoCache[k]);
    if (mode === 'server') {
      var r = get(id);
      if (r && r.hasPickPhoto && !r.hasPickPhoto[i]) { pickPhotoCache[k] = null; return Promise.resolve(null); }
      return api('photo?id=' + id + '&pick=' + i).then(function (res) { pickPhotoCache[k] = (res.ok && res.data.photo) || null; return pickPhotoCache[k]; }).catch(function () { return null; });
    }
    var lr = localFind(loadLocal(), id);
    pickPhotoCache[k] = (lr && lr.pickPhotos && lr.pickPhotos[i]) || null;
    return Promise.resolve(pickPhotoCache[k]);
  }
  function clearPickPhoto(id, i) { delete pickPhotoCache[id + ':' + i]; }

  /* ---------- rating (public, shared) + punch (per-device) ---------- */
  function rate(id, stars, upvote) {
    if (ratedRecently(id)) return Promise.resolve({ ok: false, reason: 'rate_limited' });
    var r = get(id);
    if (mode === 'server') {
      return api('rate', 'POST', { id: id, stars: stars, upvote: upvote }).then(function (res) {
        if (!res.ok) return { ok: false, reason: (res.data && res.data.error) || 'error' };
        var c = get(id); if (c) { c.upvotes = res.data.upvotes; c.totalRatings = res.data.totalRatings; c.rating = res.data.rating; }
        var rec = punch(id, r ? r.couponValidDays : 14, r ? r.reward : '');
        return { ok: true, record: rec };
      });
    }
    // local
    var d = loadLocal(); var lr = localFind(d, id);
    if (!lr) return Promise.resolve({ ok: false, reason: 'not_found' });
    lr.totalRatings += 1; lr.ratingSum += stars; lr.ratingCount += 1; if (upvote) lr.upvotes += 1;
    saveLocal(d); cache = d.restaurants.map(withRating);
    var rec2 = punch(id, lr.couponValidDays, lr.reward);
    return Promise.resolve({ ok: true, record: rec2 });
  }

  /* ---------- owner ---------- */
  var ownerTok = {}; // id -> session token
  function ownerLogin(id, pw) {
    if (mode === 'server') return api('owner', 'POST', { action: 'login', id: id, password: pw }).then(function (res) { if (res.ok && res.data.token) ownerTok[id] = res.data.token; return res.ok ? { ok: true, data: res.data } : { ok: false }; });
    var lr = localFind(loadLocal(), id); return Promise.resolve(lr && pw === lr.password ? { ok: true, data: { id: lr.id, name: lr.name, paid: lr.paid } } : { ok: false });
  }
  function ownerUpdate(id, pw, fields) {
    if (mode === 'server') return api('owner', 'POST', { action: 'update', id: id, token: ownerTok[id], password: pw, fields: fields }).then(function (res) { return { ok: res.ok }; }).then(function (r) { return refresh().then(function () { return r; }); });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr || pw !== lr.password) return Promise.resolve({ ok: false });
    if (Array.isArray(fields.picks)) lr.picks = fields.picks.slice(0, 3);
    if (typeof fields.note === 'string') lr.note = fields.note;
    if (typeof fields.website === 'string') lr.website = fields.website;
    if (typeof fields.reward === 'string') lr.reward = fields.reward;
    if (fields.couponValidDays != null) lr.couponValidDays = Math.max(1, parseInt(fields.couponValidDays, 10) || 1);
    if (fields.happyHour) lr.happyHour = fields.happyHour;
    if (typeof fields.password === 'string' && fields.password.trim()) lr.password = fields.password.trim();
    var ok = saveLocal(d); cache = d.restaurants.map(withRating);
    return Promise.resolve({ ok: ok });
  }

  function ownerPhoto(id, pw, dataUrl) {
    clearPhoto(id);
    if (mode === 'server') return api('owner', 'POST', { action: 'photo', id: id, token: ownerTok[id], password: pw, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr || pw !== lr.password) return Promise.resolve({ ok: false });
    if (!lr.paid) return Promise.resolve({ ok: false });
    lr.photo = dataUrl; lr.hasPhoto = true; var ok = saveLocal(d); cache = d.restaurants.map(withRating);
    return Promise.resolve({ ok: ok });
  }
  function ownerPickPhoto(id, pw, i, dataUrl) {
    clearPickPhoto(id, i);
    if (mode === 'server') return api('owner', 'POST', { action: 'photo', id: id, pick: i, token: ownerTok[id], password: pw, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    var d = loadLocal(), lr = localFind(d, id);
    if (!lr || pw !== lr.password) return Promise.resolve({ ok: false });
    if (!lr.paid) return Promise.resolve({ ok: false });
    if (!lr.pickPhotos) lr.pickPhotos = [null, null, null];
    if (!lr.hasPickPhoto) lr.hasPickPhoto = [false, false, false];
    lr.pickPhotos[i] = dataUrl; lr.hasPickPhoto[i] = true;
    var ok2 = saveLocal(d); cache = d.restaurants.map(withRating);
    return Promise.resolve({ ok: ok2 });
  }

  /* ---------- billing (Stripe) ---------- */
  function checkout(id, pw) {
    if (mode !== 'server') return Promise.resolve({ error: 'local' });
    return api('checkout', 'POST', { id: id, token: ownerTok[id], password: pw }).then(function (res) { return res.data || { error: 'error' }; });
  }
  function confirmUpgrade(sessionId) {
    if (mode !== 'server') return Promise.resolve({ ok: false });
    return api('upgrade-confirm', 'POST', { sessionId: sessionId }).then(function (res) { return refresh().then(function () { return res.data || { ok: false }; }); });
  }

  /* ---------- admin ---------- */
  function checkAdminLocal(pw) { var s; try { s = global.localStorage.getItem(AKEY); } catch (e) { s = null; } return pw === (s || DEFAULT_ADMIN); }
  function adminList(pw) {
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'list' }).then(function (res) { return res.ok ? { ok: true, restaurants: res.data.restaurants } : { ok: false }; });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    return Promise.resolve({ ok: true, restaurants: loadLocal().restaurants });
  }
  function adminPhoto(pw, id, dataUrl) {
    clearPhoto(id);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'photo', id: id, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    lr.photo = dataUrl; lr.hasPhoto = true; var ok = saveLocal(d); cache = d.restaurants.map(withRating);
    return Promise.resolve({ ok: ok });
  }
  function adminRemovePhoto(pw, id) {
    clearPhoto(id);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'removePhoto', id: id }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (lr) { lr.photo = null; lr.hasPhoto = false; saveLocal(d); cache = d.restaurants.map(withRating); }
    return Promise.resolve({ ok: true });
  }
  function adminPickPhoto(pw, id, i, dataUrl) {
    clearPickPhoto(id, i);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'photo', id: id, pick: i, dataUrl: dataUrl }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    if (!lr.pickPhotos) lr.pickPhotos = [null, null, null];
    if (!lr.hasPickPhoto) lr.hasPickPhoto = [false, false, false];
    lr.pickPhotos[i] = dataUrl; lr.hasPickPhoto[i] = true;
    var ok3 = saveLocal(d); cache = d.restaurants.map(withRating);
    return Promise.resolve({ ok: ok3 });
  }
  function adminRemovePickPhoto(pw, id, i) {
    clearPickPhoto(id, i);
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'removePhoto', id: id, pick: i }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id);
    if (lr) { if (!lr.pickPhotos) lr.pickPhotos=[null,null,null]; if(!lr.hasPickPhoto) lr.hasPickPhoto=[false,false,false]; lr.pickPhotos[i]=null; lr.hasPickPhoto[i]=false; saveLocal(d); cache = d.restaurants.map(withRating); }
    return Promise.resolve({ ok: true });
  }
  function adminSetFlag(pw, id, flags) {
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'setFlag', id: id, claimed: flags.claimed, paid: flags.paid }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    if (typeof flags.claimed === 'boolean') { lr.claimed = flags.claimed; if (!lr.claimed) lr.paid = false; }
    if (typeof flags.paid === 'boolean') { lr.paid = flags.paid; if (lr.paid) lr.claimed = true; }
    saveLocal(d); cache = d.restaurants.map(withRating); return Promise.resolve({ ok: true });
  }
  function adminResetPassword(pw, id) {
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'resetPassword', id: id }).then(function (res) { return { ok: res.ok, defaultPassword: res.data && res.data.defaultPassword }; });
    var d = loadLocal(), lr = localFind(d, id); if (!lr) return Promise.resolve({ ok: false });
    lr.password = defaultPassword(lr.name); saveLocal(d);
    return Promise.resolve({ ok: true, defaultPassword: lr.password });
  }
  function adminReset(pw) {
    photoCache = {};
    if (mode === 'server') return api('admin', 'POST', { password: pw, action: 'reset' }).then(function (res) { return refresh().then(function () { return { ok: res.ok }; }); });
    if (!checkAdminLocal(pw)) return Promise.resolve({ ok: false });
    var d = { restaurants: seedList() }; saveLocal(d); cache = d.restaurants.map(withRating); return Promise.resolve({ ok: true });
  }
  function setAdminPasswordLocal(pw) { try { global.localStorage.setItem(AKEY, pw); return true; } catch (e) { return false; } }

  global.EatStore = {
    RATE_WINDOW_MS: RATE_WINDOW_MS,
    init: init, refresh: refresh, mode: function () { return mode; }, isServer: function () { return mode === 'server'; },
    list: list, get: get, getPhoto: getPhoto, clearPhoto: clearPhoto,
    getPickPhoto: getPickPhoto, clearPickPhoto: clearPickPhoto,
    rate: rate, ratedRecently: ratedRecently, deviceRec: deviceRec,
    ownerLogin: ownerLogin, ownerUpdate: ownerUpdate, ownerPhoto: ownerPhoto, ownerPickPhoto: ownerPickPhoto,
    checkout: checkout, confirmUpgrade: confirmUpgrade,
    adminList: adminList, adminPhoto: adminPhoto, adminRemovePhoto: adminRemovePhoto,
    adminPickPhoto: adminPickPhoto, adminRemovePickPhoto: adminRemovePickPhoto,
    adminSetFlag: adminSetFlag, adminReset: adminReset, adminResetPassword: adminResetPassword, setAdminPasswordLocal: setAdminPasswordLocal,
    slug: slug, defaultPassword: defaultPassword, fmtNum: fmtNum, isHappyHourNow: isHappyHourNow, to12h: to12h, fileToDataUrl: fileToDataUrl
  };
})(window);
