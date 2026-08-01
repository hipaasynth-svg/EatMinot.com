/* EatMinot backend shared library.
   Storage: Vercel-provisioned Upstash Redis (KV) via its REST command API.
   No npm dependencies — uses global fetch (Node 18+ on Vercel) and built-in crypto.
   Falls back to an in-process Map for local dev / when no store is attached. */
'use strict';
var crypto = require('crypto');

var STATE_KEY = 'eatminot:state:v1';
var PHOTO_KEY = function (id) { return 'eatminot:photo:' + id; };

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

function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function defaultPassword(name) { return slug(name) + '26'; }

/* ---------- password hashing (salted SHA-256, no plaintext at rest) ---------- */
function hashPw(pw) {
  var salt = crypto.randomBytes(9).toString('hex');
  return 'sha256$' + salt + '$' + crypto.createHash('sha256').update(salt + ':' + pw).digest('hex');
}
function verifyPw(pw, stored) {
  if (!stored) return false;
  if (stored.indexOf('sha256$') !== 0) return pw === stored; // legacy plaintext, still accepted
  var p = stored.split('$');
  return crypto.createHash('sha256').update(p[1] + ':' + pw).digest('hex') === p[2];
}
function isDefaultPw(name, stored) { return verifyPw(defaultPassword(name), stored); }

/* ---------- signed owner session tokens (HMAC) ---------- */
function sessionSecret() { return process.env.EAT_SESSION_SECRET || 'eatminot-dev-secret-change-me'; }
function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function signToken(id, ttlMs) {
  var exp = Date.now() + (ttlMs || 43200000); // 12h
  var payload = id + '.' + exp;
  var sig = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return b64u(payload) + '.' + sig;
}
function verifyToken(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  var i = tok.lastIndexOf('.'), payloadB = tok.slice(0, i), sig = tok.slice(i + 1);
  var payload;
  try { payload = Buffer.from(payloadB.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(); } catch (e) { return null; }
  var good = crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  if (good !== sig) return null;
  var parts = payload.split('.'), id = parseInt(parts[0], 10), exp = parseInt(parts[1], 10);
  if (!id || !exp || Date.now() > exp) return null;
  return id;
}

// No seeded stars or upvotes — every public metric starts at zero and only
// moves on a real verified rating.
function seed() {
  return RAW.map(function (row, i) {
    var id = i + 1;
    var name = row[0];
    var claimed = id === 1; // one demo paid listing so the paid features are visible
    return {
      id: id, name: name, address: row[1], hours: row[2],
      claimed: claimed, paid: claimed, password: hashPw(defaultPassword(name)),
      stripeCustomerId: null, stripeSubscriptionId: null,
      hasPhoto: false,
      upvotes: 0, ratingSum: 0, ratingCount: 0, totalRatings: 0,
      picks: claimed ? ['Fried Chicken Sandwich', 'Loaded Tots', 'House IPA'] : ['', '', ''],
      note: '', website: claimed ? 'starvingrooster.com' : '',
      reward: 'Free item on your 10th punch', couponValidDays: 14,
      happyHour: { enabled: false, days: [1, 2, 3, 4, 5], start: '15:00', end: '17:00', special: '' }
    };
  });
}

/* ---------- storage adapter ---------- */
var mem = global.__eatmem || (global.__eatmem = new Map());
function hasKV() { return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN); }
function persistent() { return hasKV() || process.env.EAT_DEV_PERSIST === '1'; }

async function kvCmd(cmd) {
  var res = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if (!res.ok) throw new Error('KV ' + res.status);
  var j = await res.json();
  return j.result;
}
async function kvGet(key) { if (hasKV()) return kvCmd(['GET', key]); var v = mem.get(key); return v === undefined ? null : v; }
async function kvSet(key, val) { if (hasKV()) return kvCmd(['SET', key, val]); mem.set(key, val); return 'OK'; }

async function getState() {
  var raw = await kvGet(STATE_KEY);
  if (!raw) { var s = { restaurants: seed() }; await kvSet(STATE_KEY, JSON.stringify(s)); return s; }
  try { return JSON.parse(raw); } catch (e) { var s2 = { restaurants: seed() }; await kvSet(STATE_KEY, JSON.stringify(s2)); return s2; }
}
async function saveState(s) { await kvSet(STATE_KEY, JSON.stringify(s)); }
function findR(s, id) { id = parseInt(id, 10); for (var i = 0; i < s.restaurants.length; i++) if (s.restaurants[i].id === id) return s.restaurants[i]; return null; }

// Public view: never leak passwords.
function publicView(s) {
  return {
    persistent: persistent(),
    restaurants: s.restaurants.map(function (r) {
      var o = {};
      for (var k in r) o[k] = r[k];
      delete o.password;
      o.rating = r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : 0;
      return o;
    })
  };
}

/* ---------- request helpers ---------- */
function rawBody(req) {
  return new Promise(function (resolve) {
    if (typeof req.body === 'string') { resolve(req.body); return; }
    if (req.body && typeof req.body === 'object') { resolve(JSON.stringify(req.body)); return; }
    var data = '';
    req.on('data', function (c) { data += c; });
    req.on('end', function () { resolve(data); });
    req.on('error', function () { resolve(''); });
  });
}
function readBody(req) {
  return rawBody(req).then(function (raw) { try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } });
}

/* ---------- Stripe (REST, no SDK) ---------- */
function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }
function stripeConfigured() { return !!stripeKey(); }
function form(obj) {
  var parts = [];
  Object.keys(obj).forEach(function (k) { parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])); });
  return parts.join('&');
}
async function stripe(path, method, params) {
  var opts = { method: method || 'GET', headers: { Authorization: 'Bearer ' + stripeKey() } };
  if (params) { opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = form(params).replace(/%7BCHECKOUT_SESSION_ID%7D/g, '{CHECKOUT_SESSION_ID}'); }
  var r = await fetch('https://api.stripe.com/v1/' + path, opts);
  var j = await r.json();
  return { ok: r.ok, status: r.status, data: j };
}
function verifyStripeSig(raw, header, secret) {
  if (!header || !secret) return false;
  var t = null, v1 = null;
  header.split(',').forEach(function (kv) { var p = kv.split('='); if (p[0] === 't') t = p[1]; if (p[0] === 'v1') v1 = p[1]; });
  if (!t || !v1) return false;
  var expected = crypto.createHmac('sha256', secret).update(t + '.' + raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1)); } catch (e) { return false; }
}
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

var ADMIN_DEFAULT = 'minot-admin';
function checkAdmin(pw) { return pw === (process.env.EAT_ADMIN_PASSWORD || ADMIN_DEFAULT); }

module.exports = {
  STATE_KEY: STATE_KEY, PHOTO_KEY: PHOTO_KEY,
  seed: seed, slug: slug, defaultPassword: defaultPassword,
  hashPw: hashPw, verifyPw: verifyPw, isDefaultPw: isDefaultPw,
  signToken: signToken, verifyToken: verifyToken,
  persistent: persistent, hasKV: hasKV,
  kvGet: kvGet, kvSet: kvSet,
  getState: getState, saveState: saveState, findR: findR, publicView: publicView,
  readBody: readBody, rawBody: rawBody, json: json, checkAdmin: checkAdmin,
  stripe: stripe, stripeConfigured: stripeConfigured, verifyStripeSig: verifyStripeSig
};
