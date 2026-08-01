/* EatMinot shared store — seed data, persistence, helpers.
   NOTE: this is a client-side (localStorage) store. Data lives per-device.
   Passwords are checked in the browser and are NOT real security.
   Both are documented limitations to be replaced by a backend (phase 2). */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'eatminot_v2';
  var ADMIN_KEY = 'eatminot_admin_v1';
  var DEFAULT_ADMIN_PASSWORD = 'minot-admin';
  var RATE_WINDOW_MS = 86400000; // one rating per device per restaurant / 24h

  var RAW = [
    ["The Starving Rooster", "30 1st St NE, Minot, ND 58703", "Mon-Thu 11am-10pm, Fri-Sat 11am-11pm, Sun 11am-9pm"],
    ["Ebeneezer's Eatery & Irish Pub", "300 E Central Ave, Minot, ND 58701", "Daily 7am-1am (kitchen closes ~10pm)"],
    ["Bone's BBQ Smokehouse & Grill", "437 N Broadway, Minot, ND 58703", "Daily ~11am-10/11pm"],
    ["Ironhorse Kitchen + Bar", "21 E Central Ave, Minot, ND 58701", "Mon-Thu 11am-11pm, Fri-Sat 11am-12am, Closed Sun"],
    ["Charlie's Main Street Cafe", "113 Main St S, Minot, ND 58701", "Mon-Sat 7am-2pm, Sun 8am-2pm"],
    ["Kroll's Diner", "1221 20th Ave SE, Minot, ND 58701", "Typical diner hours (verify)"],
    ["Little Blue Elephant", "22 S Main St, Minot, ND 58701", "Verify hours"],
    ["Basecamp Indian Kitchen", "1425 24th Ave SW, Minot, ND 58701", "Verify hours"],
    ["Prairie Sky Breads", "3 1st St SE, Minot, ND 58701", "Morning-afternoon bakery hours"],
    ["Magic City Hoagies & Sweets", "123 Main St S, Minot, ND 58701", "Verify hours"],
    ["Minot's Daily Bread", "1500 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Badlands Restaurant and Bar", "1400 31st Ave SW, Minot, ND 58701", "Verify hours"],
    ["The Depot and Baggage Claim", "15 Main St N, Minot, ND 58703", "Verify hours"],
    ["Oishii Ramen", "Downtown Minot", "Verify hours"],
    ["Don Tapatío", "1445 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Mi Mexico Restaurant", "3816 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Baan Rao Thai Restaurant", "Minot, ND", "Verify hours"],
    ["Ziggy's Caribbean Cuisine", "201 University Ave W, Minot, ND 58703", "Verify hours"],
    ["China Star", "1631 S Broadway, Minot, ND 58701", "Verify hours"],
    ["JL Beers", "2001 22nd Ave SW, Minot, ND 58701", "Verify hours"],
    ["Sammy's Pizza", "400 N Broadway, Minot, ND 58703", "Verify hours"],
    ["Planet Pizza", "220 S Broadway, Minot, ND 58701", "Verify hours"],
    ["Nite Train Pizza", "Minot, ND", "Verify hours"],
    ["Uncle Maddio's Pizza Joint", "3310 16th St SW, Minot, ND 58701", "Verify hours"],
    ["Taco Feliz", "1535 S Broadway, Minot, ND 58701", "Verify hours"],
    ["El Azteca", "2035 N Broadway, Minot, ND 58703", "Verify hours"],
    ["Homesteaders Restaurant", "2501 Elk Dr, Minot, ND 58701", "Verify hours"],
    ["Off The Vine", "15 Main St S, Minot, ND 58701", "Verify hours"],
    ["Souris River Brewing", "32 3rd St NE, Minot, ND 58703", "Verify hours"],
    ["Broadway Bean and Bagel", "Minot, ND", "Verify hours"]
  ];

  function seededRand(seed) {
    var x = Math.sin(seed * 999) * 10000;
    return x - Math.floor(x);
  }

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Default owner password = restaurant name (normalized) + "26".
  function defaultPassword(name) {
    return slug(name) + '26';
  }

  function fmtNum(n) {
    n = Math.round(n);
    if (n >= 1000) {
      var k = n / 1000;
      return (n >= 10000 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace(/\.0$/, '') + 'k';
    }
    return String(n);
  }

  function seed() {
    return RAW.map(function (row, i) {
      var id = i + 1;
      var name = row[0];
      var claimed = id === 1; // The Starving Rooster starts claimed for demo
      var totalRatings = 60 + Math.round(seededRand(id) * 900);
      var yearly = Math.round(totalRatings * (0.55 + seededRand(id + 50) * 0.35));
      var monthly = Math.round(yearly * (0.10 + seededRand(id + 600) * 0.12));
      var weekly = Math.round(monthly * (0.20 + seededRand(id + 700) * 0.25));
      var rating = Math.min(5, Math.round((3.6 + seededRand(id + 100) * 1.3) * 10) / 10);
      var done = Math.round(seededRand(id + 200) * 9);
      var r = {
        id: id,
        name: name,
        address: row[1],
        hours: row[2],
        claimed: claimed,
        paid: claimed,
        password: defaultPassword(name),
        photo: null,
        rating: rating,
        weekly: weekly, monthly: monthly, yearly: yearly,
        totalRatings: totalRatings,
        personal: { done: done, total: 10 },
        coupon: null,
        ratedAt: 0,
        reward: 'Free item on your 10th punch',
        couponValidDays: 14,
        picks: ['', '', ''],
        note: '',
        website: '',
        happyHour: { enabled: false, days: [1, 2, 3, 4, 5], start: '15:00', end: '17:00', special: '' }
      };
      if (claimed) {
        r.picks = ['Fried Chicken Sandwich', 'Loaded Tots', 'House IPA'];
        r.note = 'Family-owned since day one — thanks for supporting local, Minot!';
        r.website = 'starvingrooster.com';
        r.reward = 'Free appetizer on your 10th punch';
        r.happyHour = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '15:00', end: '17:00', special: 'Half-price apps' };
      }
      return r;
    });
  }

  function load() {
    var data;
    try { data = JSON.parse(global.localStorage.getItem(STORAGE_KEY)); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.restaurants) || data.restaurants.length === 0) {
      data = { restaurants: seed() };
      save(data);
    }
    // forward-fill any missing fields introduced later
    var template = seed();
    data.restaurants.forEach(function (r, i) {
      var t = template[i] || {};
      for (var k in t) { if (!(k in r)) r[k] = t[k]; }
      if (!r.happyHour) r.happyHour = { enabled: false, days: [1, 2, 3, 4, 5], start: '15:00', end: '17:00', special: '' };
      if (!Array.isArray(r.picks)) r.picks = ['', '', ''];
    });
    return data;
  }

  function save(data) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      // Most likely quota exceeded (too many/too large photos).
      return false;
    }
  }

  function update(id, mutator) {
    var data = load();
    var r = data.restaurants.filter(function (x) { return x.id === id; })[0];
    if (!r) return { ok: false, reason: 'not_found' };
    mutator(r);
    var ok = save(data);
    return { ok: ok, reason: ok ? null : 'quota' };
  }

  function get(id) {
    return load().restaurants.filter(function (x) { return x.id === id; })[0] || null;
  }

  // Is the given restaurant's happy hour active at "when" (default now)?
  function isHappyHourNow(r, when) {
    var hh = r && r.happyHour;
    if (!hh || !hh.enabled) return false;
    var now = when || new Date();
    if (Array.isArray(hh.days) && hh.days.length && hh.days.indexOf(now.getDay()) === -1) return false;
    var cur = now.getHours() * 60 + now.getMinutes();
    var s = toMin(hh.start), e = toMin(hh.end);
    if (s == null || e == null) return false;
    if (e <= s) return cur >= s || cur < e; // overnight window
    return cur >= s && cur < e;
  }

  function toMin(t) {
    if (!t || t.indexOf(':') === -1) return null;
    var p = t.split(':');
    var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return h * 60 + m;
  }

  function to12h(t) {
    var m = toMin(t);
    if (m == null) return t || '';
    var h = Math.floor(m / 60), mm = m % 60;
    var ap = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + (mm ? ':' + (mm < 10 ? '0' + mm : mm) : '') + ap;
  }

  function ratedRecently(r) {
    return !!(r && r.ratedAt && (Date.now() - r.ratedAt) < RATE_WINDOW_MS);
  }

  // Downscale an image File to a compact JPEG data URL (keeps localStorage small).
  function fileToDataUrl(file, maxW, quality) {
    maxW = maxW || 900; quality = quality || 0.72;
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Not an image')); return; }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxW / img.width);
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/jpeg', quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Load failed')); };
      img.src = url;
    });
  }

  function checkAdmin(pw) {
    var stored;
    try { stored = global.localStorage.getItem(ADMIN_KEY); } catch (e) { stored = null; }
    return pw === (stored || DEFAULT_ADMIN_PASSWORD);
  }
  function setAdminPassword(pw) {
    try { global.localStorage.setItem(ADMIN_KEY, pw); return true; } catch (e) { return false; }
  }

  function resetAll() {
    var data = { restaurants: seed() };
    save(data);
    return data;
  }

  global.EatStore = {
    RATE_WINDOW_MS: RATE_WINDOW_MS,
    DEFAULT_ADMIN_PASSWORD: DEFAULT_ADMIN_PASSWORD,
    load: load, save: save, update: update, get: get,
    seed: seed, resetAll: resetAll,
    slug: slug, defaultPassword: defaultPassword, fmtNum: fmtNum,
    isHappyHourNow: isHappyHourNow, to12h: to12h, ratedRecently: ratedRecently,
    fileToDataUrl: fileToDataUrl, checkAdmin: checkAdmin, setAdminPassword: setAdminPassword
  };
})(window);
