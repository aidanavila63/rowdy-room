/* Diagnostics for the MQTT-over-WebSocket relays this game uses. Opens a
   real client connection to each public broker, sends CONNECT, and reports
   whether CONNACK comes back — the exact path browsers take. Visit
   /api/relaycheck if the game ever refuses to connect. */
const WebSocket = require('ws');

var BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];

function varint(n) {
  var o = [];
  do { var b = n & 127; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n);
  return o;
}
function strBytes(s) {
  var b = Buffer.from(s, 'utf8');
  return [b.length >> 8 & 255, b.length & 255].concat(Array.from(b));
}
function build(type, flags, body) {
  return Buffer.from([(type << 4) | flags].concat(varint(body.length)).concat(body));
}

function checkBroker(url) {
  return new Promise(function (resolve) {
    var start = Date.now();
    var done = false;
    var ws;
    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch (e) {}
      resolve(Object.assign({ url: url, ms: Date.now() - start }, result));
    }
    var timer = setTimeout(function () { finish({ ok: false, step: 'timeout' }); }, 7000);
    try {
      ws = new WebSocket(url, 'mqtt');
    } catch (e) {
      finish({ ok: false, step: 'construct', error: String(e.message || e) });
      return;
    }
    ws.on('open', function () {
      var cid = 'diag' + Math.random().toString(36).slice(2, 10);
      var body = strBytes('MQTT').concat([4, 0x02, 0, 30]).concat(strBytes(cid));
      ws.send(build(1, 0, body));
    });
    ws.on('message', function (data) {
      var buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (buf.length >= 4 && (buf[0] >> 4) === 2) {
        finish({ ok: buf[3] === 0, step: 'connack', returnCode: buf[3] });
      }
    });
    ws.on('error', function (e) { finish({ ok: false, step: 'socket', error: String(e.message || e) }); });
    ws.on('close', function (code, reason) {
      finish({ ok: false, step: 'closed', code: code, reason: String(reason || '') });
    });
  });
}

module.exports = async function handler(req, res) {
  var results = await Promise.all(BROKERS.map(checkBroker));
  var out = { ok: results.some(function (r) { return r.ok; }), brokers: results };
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.status(out.ok ? 200 : 503).end(JSON.stringify(out, null, 2));
};
