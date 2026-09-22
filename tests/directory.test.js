'use strict';
/* Directory-data regression tests. Plain Node, no npm dependencies:
     node tests/directory.test.js

   These exist because of one specific bug in the admin console's
   "Refresh hours from directory" button (api/admin.js refreshInfo).

   The RAW seed table still carries "Verify hours" for venues whose real hours were
   filled in by hand through the admin editor. Those real hours live only in the
   database — a code deploy never writes them back to the seed. refreshInfo used to
   push the seed's address and hours onto every saved profile unconditionally, which
   meant pressing it replaced every hand-entered set of hours with "Verify hours":
   a one-click wipe of exactly the work the button appears to be refreshing.

   A placeholder is never an improvement on something a human typed. */

var admin = require('../api/admin.js');
var L = require('../api/_lib.js');

var pass = 0, fail = 0;
function ok(cond, what) {
  if (cond) { pass++; console.log('  ok   ' + what); }
  else { fail++; console.log('  FAIL ' + what); }
}
function call(body) {
  return new Promise(function (resolve) {
    var req = { method: 'POST', body: body, headers: {} };
    var res = {
      statusCode: 200,
      setHeader: function () {},
      end: function (p) { resolve({ status: res.statusCode, body: JSON.parse(p) }); }
    };
    admin(req, res);
  });
}

var ADMIN = process.env.EAT_ADMIN_PASSWORD || 'minot-admin';

(async function () {
  console.log('\nplaceholder detection');

  ok(L.isPlaceholderHours('Verify hours'), '"Verify hours" is a placeholder');
  ok(L.isPlaceholderHours(''), 'empty hours are a placeholder');
  ok(L.isPlaceholderHours('   '), 'whitespace hours are a placeholder');
  ok(!L.isPlaceholderHours('Mon-Sat 11am-9pm, Sun Closed'), 'real hours are not a placeholder');
  ok(L.isPlaceholderAddress('Minot, ND'), '"Minot, ND" alone is a placeholder address');
  ok(L.isPlaceholderAddress('Downtown Minot'), '"Downtown Minot" is a placeholder address');
  ok(L.isPlaceholderAddress('Multiple locations, Minot, ND'), '"Multiple locations" is a placeholder');
  ok(!L.isPlaceholderAddress('22 S Main St, Minot, ND 58701'), 'a street address is not a placeholder');

  console.log('\nrefreshInfo must not wipe hand-entered data');

  // A venue whose seed hours are still the "Verify hours" placeholder.
  var PLACEHOLDER_ID = 7;
  ok(L.isPlaceholderHours(L.seedProfile(PLACEHOLDER_ID).hours),
     'venue ' + PLACEHOLDER_ID + ' seed hours are a placeholder (the precondition)');

  var REAL_HOURS = 'Mon-Sat 11am-9pm, Sun Closed';
  var REAL_ADDR = '22 S Main St, Minot, ND 58701';
  await call({ password: ADMIN, action: 'setInfo', id: PLACEHOLDER_ID, address: REAL_ADDR, hours: REAL_HOURS });
  ok((await L.getProfile(PLACEHOLDER_ID)).hours === REAL_HOURS, 'the admin editor saves real hours');

  var r = await call({ password: ADMIN, action: 'refreshInfo' });
  ok(r.status === 200, 'refreshInfo succeeds');
  ok((await L.getProfile(PLACEHOLDER_ID)).hours === REAL_HOURS,
     'refreshInfo leaves hand-entered hours alone');
  ok(typeof r.body.skipped === 'number', 'refreshInfo reports what it skipped');

  console.log('\n...but must still push corrected seed data');

  // A venue whose seed carries real hours: a stale stored value must be overwritten,
  // otherwise the button no longer does its job.
  var REAL_SEED_ID = 1;
  var seedHours = L.seedProfile(REAL_SEED_ID).hours;
  ok(!L.isPlaceholderHours(seedHours),
     'venue ' + REAL_SEED_ID + ' seed hours are real (the precondition)');

  await call({ password: ADMIN, action: 'setInfo', id: REAL_SEED_ID, hours: 'stale wrong hours' });
  await call({ password: ADMIN, action: 'refreshInfo' });
  ok((await L.getProfile(REAL_SEED_ID)).hours === seedHours,
     'refreshInfo still overwrites a stale value when the seed has real hours');

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
