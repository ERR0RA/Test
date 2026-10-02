(function(){
  // Unicode-safe btoa
  var o = window.btoa;
  window.btoa = function(s) {
    try { return o(s); } catch(e) {
      return o(unescape(encodeURIComponent(s)));
    }
  };

  // Sparx submits answers to /sparx.swworker.v1.Sparxweb/ActivityAction as
  // gRPC-Web binary protobuf. The first 5 bytes are the gRPC-Web frame header
  // (1 byte flag + 4 byte big-endian length); the rest is a protobuf message.
  // We don't have the .proto schema, so we walk the message generically and
  // pull out every printable string field — content.js then picks the answer
  // out of that list heuristically.

  function isSubmitUrl(url) {
    if (!url) return false;
    try { return /\/ActivityAction\b/.test(String(url)); } catch(e) { return false; }
  }

  function toBytes(body) {
    if (!body) return null;
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return null;
  }

  // Recursively walk a protobuf-encoded byte range and return all printable
  // string fields it contains (including those inside nested messages).
  function extractStrings(bytes, start, end) {
    var out = [];
    var off = start;
    function readVarint() {
      var v = 0, shift = 0;
      while (off < end) {
        var b = bytes[off++];
        v |= (b & 0x7f) << shift;
        if (!(b & 0x80)) return v;
        shift += 7;
        if (shift >= 35) return v;
      }
      return v;
    }
    while (off < end) {
      var tag = bytes[off++];
      var wire = tag & 7;
      if (wire === 0) { readVarint(); continue; }
      if (wire === 1) { off += 8; continue; }
      if (wire === 5) { off += 4; continue; }
      if (wire !== 2) break; // unknown wire type, abort
      var len = readVarint();
      var chunkEnd = off + len;
      if (chunkEnd > end || len < 0) break;
      // Heuristic: if every byte is printable ASCII, treat as a string.
      // Otherwise try parsing as a nested message — if that fails silently it's
      // just bytes we ignore.
      var allPrint = len > 0 && len < 200;
      for (var i = 0; allPrint && i < len; i++) {
        var c = bytes[off + i];
        if (c < 32 && c !== 9 && c !== 10 && c !== 13) allPrint = false;
        else if (c > 126) allPrint = false;
      }
      if (allPrint) {
        var s = '';
        for (var k = 0; k < len; k++) s += String.fromCharCode(bytes[off + k]);
        out.push(s);
      } else {
        var nested = extractStrings(bytes, off, chunkEnd);
        for (var j = 0; j < nested.length; j++) out.push(nested[j]);
      }
      off = chunkEnd;
    }
    return out;
  }

  function emitFromBody(url, body) {
    var bytes = toBytes(body);
    if (!bytes || bytes.length <= 5) return;
    var strings = extractStrings(bytes, 5, bytes.length);
    if (!strings.length) return;
    try {
      window.dispatchEvent(new CustomEvent('sparx-solver-submit', {
        detail: { url: url, strings: strings }
      }));
    } catch(e) {}
  }

  // ---- fetch ----
  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isSubmitUrl(url) && init && init.body) emitFromBody(url, init.body);
      } catch(e) {}
      return origFetch.apply(this, arguments);
    };
  }

  // ---- XMLHttpRequest ----
  if (typeof XMLHttpRequest !== 'undefined') {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      try { this.__sparxUrl = url; } catch(e) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      try { if (isSubmitUrl(this.__sparxUrl)) emitFromBody(this.__sparxUrl, body); } catch(e) {}
      return origSend.apply(this, arguments);
    };
  }
})();
