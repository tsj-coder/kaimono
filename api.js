var KaimonoApi = (function () {
  var REQUIRED_API = 1;
  var CONNECTION_KEY = 'kaimono.conn';

  class ApiError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ApiError';
      this.code = code;
    }
  }

  function encodeCode(connection) {
    var bytes = new TextEncoder().encode(JSON.stringify({ u: connection.u, t: connection.t }));
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'kaimono1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCode(text) {
    try {
      if (typeof text !== 'string') throw new Error();
      var match = /^kaimono1\.([A-Za-z0-9_-]+)$/.exec(text.trim());
      if (!match) throw new Error();
      var base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      var binary = atob(base64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var connection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!connection || typeof connection.u !== 'string' || !connection.u ||
          typeof connection.t !== 'string' || !connection.t) throw new Error();
      return { u: connection.u, t: connection.t };
    } catch (e) {
      throw new ApiError('setup', '接続コードが読み取れません');
    }
  }

  function isAllowedUrl(u, origin) {
    if (typeof u !== 'string' || u !== u.trim()) return false;
    return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) ||
      (typeof origin === 'string' && origin !== '' && u === origin + '/exec');
  }

  function createApi(options) {
    var fetch = options.fetch;
    var storage = options.storage;
    var connection = null;
    try {
      var saved = JSON.parse(storage.getItem(CONNECTION_KEY));
      if (saved && isAllowedUrl(saved.u, options.origin) && typeof saved.t === 'string' && saved.t) {
        connection = { u: saved.u, t: saved.t };
      }
    } catch (e) {
      // 保存先を読めないときも、新しく接続できる。
    }

    async function readJson(url, init) {
      try {
        var response = await fetch(url, init);
        if (!response.ok) throw new Error();
        return await response.json();
      } catch (e) {
        throw new ApiError('network', 'データ置き場に接続できません');
      }
    }

    async function request(target, fn, args) {
      var data = await readJson(target.u, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ v: REQUIRED_API, token: target.t, fn: fn, args: args }),
        redirect: 'follow',
      });
      if (!data || typeof data.ok !== 'boolean') {
        throw new ApiError('network', 'データ置き場に接続できません');
      }
      if (!data.ok) {
        // 知らない code は、壊れた返事として「つながらない」扱いにする（操作を捨てさせない）。
        if (['auth', 'version', 'fn', 'error'].indexOf(data.code) < 0) {
          throw new ApiError('network', 'データ置き場に接続できません');
        }
        throw new ApiError(data.code, data.error);
      }
      if (typeof data.api !== 'number' || data.api < REQUIRED_API) {
        throw new ApiError('version', 'データ置き場の更新が必要です');
      }
      return data.result;
    }

    async function connect(codeText) {
      var next = decodeCode(codeText);
      if (!isAllowedUrl(next.u, options.origin)) throw new ApiError('setup', '接続コードが読み取れません');
      await request(next, 'apiGetVersion', []);
      connection = next;
      try {
        storage.setItem(CONNECTION_KEY, JSON.stringify(next));
      } catch (e) {
        // 保存できないときは、この画面を開いている間だけ接続を持つ。
      }
    }

    function disconnect() {
      connection = null;
      try {
        storage.removeItem(CONNECTION_KEY);
      } catch (e) {
        // 保存先が使えない場合も、メモリ内の接続は消す。
      }
    }

    async function call(fn, args) {
      if (!connection) throw new ApiError('setup', '接続コードを設定してください');
      if (fn === 'apiGetImages') {
        var index = await readJson(options.imageIndexUrl, { method: 'GET' });
        if (!index || !index.bundles || typeof index.bundles !== 'object') {
          throw new ApiError('network', 'データ置き場に接続できません');
        }
        var bundle = (args || [])[0];
        var keys = Object.prototype.hasOwnProperty.call(index.bundles, bundle) ? index.bundles[bundle] : [];
        if (!Array.isArray(keys)) keys = [];
        var images = {};
        keys.forEach(function (key) { images[key] = 'img/' + key + '.webp'; });
        return { version: index.version, images: images };
      }
      return request(connection, fn, args);
    }

    return {
      isConfigured: function () { return connection !== null; },
      connect: connect,
      disconnect: disconnect,
      getCode: function () { return connection ? encodeCode(connection) : ''; },
      call: call,
    };
  }

  return {
    REQUIRED_API: REQUIRED_API, encodeCode: encodeCode, decodeCode: decodeCode,
    isAllowedUrl: isAllowedUrl, ApiError: ApiError, createApi: createApi,
  };
}());

if (typeof window !== 'undefined') window.KaimonoApi = KaimonoApi;
if (typeof module !== 'undefined') module.exports = KaimonoApi;
