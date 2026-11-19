// PWA の外側：接続コードの設定画面と、歯車の設定。画面本体（app.js）より先に読み込む。

// アドレスの #c=接続コード を読む（DOM に触らない）。不正な % が混じっていたら bad: true。
function readSetupHash(hash) {
  var match = /^#c=(.+)$/.exec(hash || '');
  if (!match) return { code: null, bad: false };
  try {
    return { code: decodeURIComponent(match[1]), bad: false };
  } catch (e) {
    return { code: null, bad: true };
  }
}

// 新しい版に替わったとき、どうするか。
//   isUpdate：初めての導入の claim ではなく、版の入れ替わりか
//   busy：シートを開いている・保存中・未送信の操作がある
//   lastReloadedBuild：自動で読み込み直した元の版（印）。currentBuild：いま開いている版
//   同じ版のまま再び来たときは繰り返さず帯にする（読み込み直しの繰り返しを止める）。版が取れないときも帯。
// 'reload'＝そのまま読み込み直す／'bar'＝「新しい版があります」の帯を出す／'none'＝何もしない
function decideUpdate(state) {
  if (!state.isUpdate) return 'none';
  if (state.busy || !state.currentBuild || state.lastReloadedBuild === state.currentBuild) return 'bar';
  return 'reload';
}

// controllerchange の配線。env は { serviceWorker, storage(), build(), isBusy(), reload(), showBar() }。
// 開いた時点で Service Worker が動いていれば、最初の controllerchange から更新。
// 動いていなければ（初めての導入）、1回目は claim なので無視し、2回目以降を更新とする。
function wireUpdates(env) {
  var changes = 0;
  var hadController = !!env.serviceWorker.controller;
  var MARK = 'kaimono-reloaded-for-update';
  env.serviceWorker.addEventListener('controllerchange', function () {
    changes += 1;
    var last = null;
    try { last = env.storage().getItem(MARK); } catch (e) { last = env.build(); /* 読めなければ繰り返さない */ }
    var decision = decideUpdate({
      isUpdate: hadController || changes >= 2,
      busy: !!env.isBusy(),
      lastReloadedBuild: last,
      currentBuild: env.build(),
    });
    if (decision === 'reload') {
      try { env.storage().setItem(MARK, env.build()); } catch (e) { env.showBar(); return; }
      env.reload();
    } else if (decision === 'bar') {
      env.showBar();
    }
  });
}

// 「はじめての端末」欄の判定（DOM に触らない）。URL と合言葉を trim し、空と URL の形を確かめる。
//   isAllowedUrl：KaimonoApi.isAllowedUrl（接続先として許す形か）
//   合言葉は、返す message にも入れない。
// 返り値：{ ok: true, u, t } か { ok: false, message }
function checkFirstDevice(url, token, isAllowedUrl) {
  var u = typeof url === 'string' ? url.trim() : '';
  var t = typeof token === 'string' ? token.trim() : '';
  if (!u || !t) return { ok: false, message: 'URL と合言葉を入れてください' };
  if (!isAllowedUrl(u)) return { ok: false, message: 'URL の形が違います（https://script.google.com/macros/s/…/exec）' };
  return { ok: true, u: u, t: t };
}

if (typeof module !== 'undefined') {
  module.exports = { readSetupHash: readSetupHash, decideUpdate: decideUpdate, wireUpdates: wireUpdates, checkFirstDevice: checkFirstDevice };
}

(function () {
  if (typeof window === 'undefined') return;
  var storage = null;
  try { storage = window.localStorage; } catch (e) { /* 保存先が使えなくても動く */ }
  if (!storage) {
    var mem = {};
    storage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
    };
  }

  // 手元の確認用サーバー（localhost）のときだけ、その場所の接続先も受け付ける
  var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var allowedOrigin = local ? location.origin : '';
  var api = KaimonoApi.createApi({
    fetch: window.fetch.bind(window),
    storage: storage,
    origin: allowedOrigin,
    imageIndexUrl: 'img/index.json',
  });

  var overlay = null;
  var stickyMessage = '';   // 画面本体の読み込み失敗で上書きされたくない案内（リンクの接続コード不正）

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function closeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function openOverlay(title) {
    closeOverlay();
    overlay = el('div', 'kshell');
    var box = el('div', 'kshell-box');
    box.appendChild(el('h2', 'kshell-title', title));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return box;
  }

  function reloadApp() {
    if (window.KaimonoApp) window.KaimonoApp.reload();
  }

  function showSetup(message) {
    var box = openOverlay('はじめの設定');
    box.appendChild(el('p', 'kshell-note', '共有された接続コードを貼って、「つなぐ」を押してください。'));
    var input = el('textarea', 'kshell-input');
    input.rows = 4;
    input.placeholder = 'kaimono1.…';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.spellcheck = false;
    var error = el('p', 'kshell-error', stickyMessage || message || '');
    var go = el('button', 'kshell-btn primary', 'つなぐ');
    go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true;
      stickyMessage = '';
      error.textContent = '';
      api.connect(input.value).then(function () {
        closeOverlay();
        reloadApp();
      }, function (e) {
        error.textContent = (e && e.message) ? e.message : String(e);
        go.disabled = false;
      });
    });
    box.appendChild(input);
    box.appendChild(error);
    box.appendChild(go);
    box.appendChild(firstDeviceSection());
  }

  // 1台目：接続コードをまだ持っていないので、URL と合言葉を別々に入れてもつなげる。
  // 組み立てた接続コードは、貼り付けと同じ api.connect に渡す（新しい保存経路は作らない）。
  function firstDeviceSection() {
    var details = el('details', 'kshell-first');
    details.appendChild(el('summary', '', 'はじめての端末：URL と合言葉を入れる'));
    var urlLabel = el('label', 'kshell-label', 'GAS の URL');
    var urlInput = el('input', 'kshell-input');
    urlInput.type = 'url';
    urlLabel.appendChild(urlInput);
    var tokenLabel = el('label', 'kshell-label', '合言葉');
    var tokenInput = el('input', 'kshell-input');
    tokenInput.type = 'password';
    tokenLabel.appendChild(tokenInput);
    [urlInput, tokenInput].forEach(function (input) {
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.spellcheck = false;
    });
    var error = el('p', 'kshell-error', '');
    var go = el('button', 'kshell-btn primary', 'つなぐ');
    go.type = 'button';
    go.addEventListener('click', function () {
      error.textContent = '';
      stickyMessage = '';
      var checked = checkFirstDevice(urlInput.value, tokenInput.value, function (u) { return KaimonoApi.isAllowedUrl(u, allowedOrigin); });
      if (!checked.ok) { error.textContent = checked.message; return; }
      go.disabled = true;
      api.connect(KaimonoApi.encodeCode({ u: checked.u, t: checked.t })).then(function () {
        tokenInput.value = '';   // 成功したら入力欄を消す（合言葉を画面に残さない）
        urlInput.value = '';
        closeOverlay();
        reloadApp();
      }, function (e) {
        error.textContent = (e && e.message) ? e.message : String(e);
        go.disabled = false;
      });
    });
    details.appendChild(urlLabel);
    details.appendChild(tokenLabel);
    details.appendChild(error);
    details.appendChild(go);
    return details;
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = el('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error());
      } catch (e) { reject(e); }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function openSettings() {
    var box = openOverlay('設定');
    var status = el('p', 'kshell-note', '');
    var copy = el('button', 'kshell-btn', '接続コードをコピー');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      copyText(api.getCode()).then(function () {
        status.textContent = 'コピーしました。';
      }, function () {
        status.textContent = 'コピーできませんでした。';
      });
    });
    var clear = el('button', 'kshell-btn danger', '接続先を消す');
    clear.type = 'button';
    clear.addEventListener('click', function () {
      var busy = window.KaimonoApp && window.KaimonoApp.isBusy();
      var ask = '接続先を消します。もう一度つなぐには接続コードが要ります。' +
        (busy ? '\nまだ送っていない操作があります。' : '') + '\nよろしいですか？';
      if (!window.confirm(ask)) return;
      api.disconnect();
      showSetup('');
    });
    var close = el('button', 'kshell-btn text', '閉じる');
    close.type = 'button';
    close.addEventListener('click', closeOverlay);
    box.appendChild(copy);
    box.appendChild(status);
    box.appendChild(clear);
    box.appendChild(el('p', 'kshell-note', '版 ' + (window.KAIMONO_BUILD || '不明')));
    box.appendChild(close);
  }

  window.KaimonoPwa = {
    api: api,
    queue: KaimonoQueue,
    shell: { showSetup: showSetup, openSettings: openSettings },
    build: window.KAIMONO_BUILD || '',
  };

  // Service Worker：画面を圏外でも出す。準備ができたら、全部の絵を端末に保存してもらう
  function cacheImages(registration) {
    var worker = registration.active;
    if (!worker) return;
    fetch('img/index.json').then(function (res) { return res.json(); }).then(function (index) {
      var urls = [];
      Object.keys(index.bundles || {}).forEach(function (name) {
        index.bundles[name].forEach(function (key) { urls.push('img/' + key + '.webp'); });
      });
      worker.postMessage({ type: 'cache-images', version: index.version, urls: urls });
    }).catch(function () { /* 絵は次の機会に */ });
  }
  var updateBar = null;

  function showUpdateBar() {
    if (updateBar) return;
    updateBar = el('div', 'kshell-update');
    updateBar.setAttribute('role', 'status');
    updateBar.appendChild(el('span', 'kshell-update-text', '新しい版があります'));
    var go = el('button', 'kshell-update-btn', '更新');
    go.type = 'button';
    go.addEventListener('click', function () { location.reload(); });
    updateBar.appendChild(go);
    document.body.appendChild(updateBar);
  }

  if ('serviceWorker' in navigator) {
    var registration = null;
    wireUpdates({
      serviceWorker: navigator.serviceWorker,
      storage: function () { return window.sessionStorage; },
      build: function () { return window.KAIMONO_BUILD || ''; },
      isBusy: function () { return !!(window.KaimonoApp && window.KaimonoApp.isBusy()); },
      reload: function () { location.reload(); },
      showBar: showUpdateBar,
    });
    // 画面に戻ってきたとき、新しい版がないか見に行く
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && registration) registration.update().catch(function () { /* 圏外など */ });
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        registration = reg;
        return navigator.serviceWorker.ready;
      }).then(cacheImages).catch(function () { /* 登録できなくても画面は動く */ });
    });
  }

  // アドレスの #c=接続コード で自動的につなぐ。接続コードは秘密なので、つなぐ前に同期でアドレスから消す。
  var setup = readSetupHash(location.hash);
  if (setup.code !== null || setup.bad) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 消せなくても先へ進む */ }
    if (setup.bad) {
      stickyMessage = '接続コードが読み取れません';
      showSetup('');
    } else {
      api.connect(setup.code).then(function () {
        closeOverlay();
        reloadApp();
      }, function (e) {
        showSetup((e && e.message) ? e.message : String(e));
      });
    }
  }
})();
