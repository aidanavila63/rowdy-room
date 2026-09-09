/* Transport.
 *
 * One persistent MQTT-over-WebSocket connection per device, to two public
 * brokers at once. Why not plain HTTP: a phone on a shared WiFi shares its
 * IP with everyone else in the room, and per-IP request limits then starve
 * whoever joined last. A socket costs one connection and then nothing per
 * message, and MQTT's retained messages mean a phone that joins (or comes
 * back) is handed the current game state immediately, without asking.
 *
 * ?bus=bc      -> BroadcastChannel, for testing tabs on one machine
 * ?relay=<url> -> point at specific broker(s), comma separated
 */
(function (global) {
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];
  var PREFIX = 'mltg2/';

  function qs(name) {
    try {
      var m = new RegExp('[?&]' + name + '=([^&]*)').exec(global.location.search);
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ */
  /* a small MQTT 3.1.1 client (QoS 0) over WebSocket                     */
  /* ------------------------------------------------------------------ */
  function varint(n) {
    var o = [];
    do { var b = n & 127; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n);
    return o;
  }
  function utf8(s) {
    if (global.TextEncoder) return new TextEncoder().encode(s);
    var arr = [], i, c;                       /* node fallback */
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); arr.push(c); }
    return new Uint8Array(arr);
  }
  function fromUtf8(bytes) {
    if (global.TextDecoder) return new TextDecoder().decode(bytes);
    return String.fromCharCode.apply(null, bytes);
  }
  function strBytes(s) {
    var b = utf8(s), o = [b.length >> 8 & 255, b.length & 255], i;
    for (i = 0; i < b.length; i++) o.push(b[i]);
    return o;
  }
  function build(type, flags, body) {
    var head = [(type << 4) | flags].concat(varint(body.length));
    var out = new Uint8Array(head.length + body.length);
    out.set(head, 0);
    out.set(body, head.length);
    return out;
  }

  function mqtt(url, clientId, onOpen, onMessage, onClose) {
    var sock, buf = new Uint8Array(0), pinger = null, dead = false;

    function bye(why) {
      if (dead) return;
      dead = true;
      clearInterval(pinger);
      try { sock.close(); } catch (e) {}
      onClose(why);
    }

    try {
      sock = new global.WebSocket(url, 'mqtt');
    } catch (e) {
      setTimeout(function () { onClose('bad-url'); }, 0);
      return { publish: function () {}, close: function () {} };
    }
    sock.binaryType = 'arraybuffer';

    sock.onopen = function () {
      var body = strBytes('MQTT').concat([4, 0x02, 0, 60]).concat(strBytes(clientId));
      raw(build(1, 0, body));
    };
    sock.onclose = function () { bye('closed'); };
    sock.onerror = function () { bye('error'); };
    sock.onmessage = function (ev) {
      var chunk = new Uint8Array(ev.data);
      var merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf, 0); merged.set(chunk, buf.length);
      buf = merged;
      for (;;) {
        if (buf.length < 2) return;
        var mult = 1, len = 0, i = 1, b;
        do {
          if (i >= buf.length) return;
          b = buf[i++];
          len += (b & 127) * mult;
          mult *= 128;
          if (mult > 2097152) { bye('malformed'); return; }
        } while (b & 128);
        if (buf.length < i + len) return;
        handle(buf[0], buf.subarray(i, i + len));
        buf = buf.slice(i + len);
      }
    };

    function raw(bytes) {
      try { sock.send(bytes); } catch (e) { bye('send'); }
    }

    function handle(byte0, body) {
      var type = byte0 >> 4;
      if (type === 2) {                                   /* CONNACK */
        if (body.length >= 2 && body[1] !== 0) { bye('refused'); return; }
        pinger = setInterval(function () { raw(build(12, 0, [])); }, 25000);
        onOpen();
      } else if (type === 3) {                            /* PUBLISH */
        var qos = (byte0 >> 1) & 3;
        var tl = (body[0] << 8) | body[1];
        var topic = fromUtf8(body.subarray(2, 2 + tl));
        var off = 2 + tl + (qos > 0 ? 2 : 0);
        onMessage(topic, fromUtf8(body.subarray(off)));
      }
    }

    return {
      subscribe: function (topic) {
        raw(build(8, 2, [0, 1].concat(strBytes(topic)).concat([0])));
      },
      publish: function (topic, payload, retain) {
        var body = strBytes(topic), p = utf8(payload), i;
        for (i = 0; i < p.length; i++) body.push(p[i]);
        raw(build(3, retain ? 1 : 0, body));
      },
      close: function () { dead = true; clearInterval(pinger); try { sock.close(); } catch (e) {} }
    };
  }

  /* ------------------------------------------------------------------ */
  /* the bus                                                             */
  /* ------------------------------------------------------------------ */
  function createBus(opts) {
    var code = String(opts.code || '').toLowerCase();
    var base = PREFIX + code;
    var host = opts.role === 'host';
    var subTopic = base + (host ? '/i' : '/s');
    var pubTopic = base + (host ? '/s' : '/i');

    var listeners = [], statusCbs = [], status = 'connecting', closed = false;
    var seen = Object.create(null), seenOrder = [];
    var queue = [], retained = null, nextId = 0;
    var bc = null, conns = [];

    var mode = qs('bus') || 'mqtt';
    var urls = (qs('relay') || '').split(',').filter(Boolean);
    if (!urls.length) urls = BROKERS;

    function setStatus(s) {
      if (s === status || closed) return;
      status = s;
      statusCbs.forEach(function (f) { try { f(s); } catch (e) {} });
    }

    function recompute() {
      var anyReady = conns.some(function (c) { return c.ready; });
      var anyTrying = conns.some(function (c) { return c.trying; });
      setStatus(anyReady ? 'online' : (anyTrying ? 'connecting' : 'offline'));
    }

    function deliver(msg) {
      if (msg && msg.id) {
        if (seen[msg.id]) return;
        seen[msg.id] = 1;
        seenOrder.push(msg.id);
        if (seenOrder.length > 400) delete seen[seenOrder.shift()];
      }
      listeners.forEach(function (f) { try { f(msg); } catch (e) { console.error(e); } });
    }

    /* ---- BroadcastChannel mode (local testing) ---- */
    if (mode === 'bc') {
      bc = new global.BroadcastChannel('mlt-' + code);
      bc.onmessage = function (ev) {
        var m = ev.data;
        if (!m || m.__to !== subTopic) return;
        var copy = {};
        Object.keys(m).forEach(function (k) { if (k !== '__to') copy[k] = m[k]; });
        deliver(copy);
      };
      setTimeout(function () { setStatus('online'); }, 0);
    } else {
      /* Build every connection object first, then start them — recompute()
         reads the conns array, so it must already hold every entry before
         any connect() attempt can run (even synchronously). */
      urls.forEach(function (url) { conns.push(makeConn(url)); });
      conns.forEach(function (c) { c.start(); });
    }

    function makeConn(url) {
      var c = { url: url, sock: null, ready: false, trying: true, backoff: 700, timer: null, start: connect };
      function connect() {
        if (closed) return;
        c.trying = true;
        c.ready = false;
        recompute();
        var cid = 'mlt' + Math.random().toString(36).slice(2, 12);
        c.sock = mqtt(url, cid,
          function () {                                     /* connected */
            c.ready = true;
            c.trying = false;
            c.backoff = 700;
            recompute();
            c.sock.subscribe(subTopic);
            /* make sure this broker also holds the current state */
            if (retained) c.sock.publish(pubTopic, retained, true);
            flush();
          },
          function (topic, payload) {                       /* message */
            var m;
            try { m = JSON.parse(payload); } catch (e) { return; }
            if (m && m.v === 1) deliver(m);
          },
          function () {                                     /* gone */
            var wasReady = c.ready;
            c.ready = false;
            c.trying = false;
            recompute();
            if (closed) return;
            var wait = wasReady ? 400 : c.backoff;
            c.backoff = Math.min(Math.round(c.backoff * 1.8), 15000);
            clearTimeout(c.timer);
            c.timer = setTimeout(connect, wait + Math.random() * 400);
          });
      }
      return c;
    }

    function publishAll(payload, retain) {
      var sent = false;
      conns.forEach(function (c) {
        if (!c.ready) return;
        try { c.sock.publish(pubTopic, payload, retain); sent = true; } catch (e) {}
      });
      return sent;
    }

    function flush() {
      if (!queue.length) return;
      var pending = queue.slice();
      queue = [];
      pending.forEach(function (item) {
        if (!publishAll(item.payload, item.retain)) queue.push(item);
      });
    }

    function post(msg, replaceKey, retain) {
      msg.v = 1;
      msg.id = (msg.id || (Date.now().toString(36) + (nextId++).toString(36) +
        Math.random().toString(36).slice(2, 6)));
      var payload = JSON.stringify(msg);
      if (retain) retained = payload;

      if (mode === 'bc') {
        var wire = JSON.parse(payload);
        wire.__to = pubTopic;
        try { bc.postMessage(wire); } catch (e) {}
        return;
      }
      if (replaceKey) {
        for (var i = queue.length - 1; i >= 0; i--) {
          if (queue[i].key === replaceKey) queue.splice(i, 1);
        }
      }
      if (!publishAll(payload, retain)) {
        queue.push({ key: replaceKey || null, payload: payload, retain: !!retain });
        if (queue.length > 40) queue.shift();
      }
    }

    return {
      send: function (msg, replaceKey) { post(msg, replaceKey, false); },
      /* Host only: the room's current state, kept by the broker so any phone
         that connects later is handed it straight away. */
      sendState: function (msg) { post(msg, 'state', true); },
      clearState: function () {
        retained = null;
        if (mode !== 'bc') conns.forEach(function (c) {
          if (c.ready) { try { c.sock.publish(pubTopic, '', true); } catch (e) {} }
        });
      },
      on: function (f) { listeners.push(f); },
      onStatus: function (f) { statusCbs.push(f); f(status); },
      get status() { return status; },
      close: function () {
        closed = true;
        conns.forEach(function (c) { clearTimeout(c.timer); if (c.sock) c.sock.close(); });
        conns = [];
        try { if (bc) bc.close(); } catch (e) {}
      }
    };
  }

  global.MLT = global.MLT || {};
  global.MLT.createBus = createBus;
  global.MLT.qs = qs;
  global.MLT.BROKERS = BROKERS;
})(typeof window !== 'undefined' ? window : globalThis);
