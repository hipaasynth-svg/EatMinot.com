'use strict';
var L = require('./_lib');

// GET /api/photo?id=NN -> { photo: dataUrl|null }
module.exports = async function (req, res) {
  try {
    var url = require('url').parse(req.url, true);
    var id = parseInt((url.query && url.query.id) || '0', 10);
    if (!id) { L.json(res, 400, { error: 'id' }); return; }
    var data = await L.kvGet(L.PHOTO_KEY(id));
    L.json(res, 200, { photo: data || null });
  } catch (e) {
    L.json(res, 500, { error: 'photo_failed' });
  }
};
