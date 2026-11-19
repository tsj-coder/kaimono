(function () {
  var PWA = window.KaimonoPwa || null;   // PWA として動くときだけある（GAS・preview.html では null）
  var ICON = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 8v8M8 12h8"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
  };
  var SORTS = [['cat', 'カテゴリ'], ['old', '古い順'], ['urgent', '急ぎ']];

  // localStorage はすべて try/catch（使えない端末でも動く）
  function store(k, v) {
    try {
      if (arguments.length === 1) return localStorage.getItem('kaimono.' + k);
      if (v == null) localStorage.removeItem('kaimono.' + k); else localStorage.setItem('kaimono.' + k, v);
    } catch (e) { return null; }
  }

  var S = {
    tab: 'list',                // 'list' | 'add'
    data: null,                 // apiGetState の結果
    version: '',
    busy: 0,                    // 自分の保存中は読み直さない（重なっても数えられるよう数で持つ）
    loading: false,
    sort: store('sort') || 'cat',
    cat: 'recent',              // 追加画面で選んでいるカテゴリ（'recent' は最近買った）
    q: '',                      // 検索
    lastSeen: store('lastSeen') || '',
    pendingDone: {},            // チェック直後で取り消し線を出している id → true
    sheet: null,                // 開いている下からのシート { kind:'add'|'edit'|'custom', ... }
    images: {},                 // 画像キー → data URL（端末に覚えたもの＋取り寄せたもの）
    fetching: {},               // 取り寄せ中の束
    server: null,               // 最後に取れたサーバーの内容そのまま（PWA のとき S.data は、これに未送信の操作を重ねたもの）
    queue: [],                  // 圏外で押して、まだ送れていないチェック（PWA のときだけ）
    offline: false,             // 最後の通信が圏外で失敗した（PWA のときだけ）
    authStopped: false,         // 合言葉・接続先の違いで止まり、設定画面を出した。つなぎ直す（reload）まで確認も送信も止める（PWA のときだけ）
    versionStopped: false,      // データ置き場が古い・想定外の返事で止まった。reload か開き直しまで確認も送信も止める。操作は残す（PWA のときだけ）
    flushing: null              // 送信中の flush の Promise（終わりの整理まで含む）。同じ id の新しい操作は、これが終わるまで待たせる（PWA のときだけ）
  };
  if (['cat', 'old', 'urgent'].indexOf(S.sort) < 0) S.sort = 'cat';
  var DEVICE = store('device') || (function () { var d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); store('device', d); return d; })();

  // ---------- サーバー呼び出し ----------
  function run(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (PWA) return PWA.api.call(fn, args);
    return new Promise(function (resolve, reject) {
      var r = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      r[fn].apply(r, args);
    });
  }
  function load() {
    S.loading = true;
    if (S.data) renderSync();
    return run('apiGetState').then(function (d) {
      var first = !S.data;
      setData(d); S.version = d.version; S.loading = false;
      if (PWA) { S.offline = false; store('state', JSON.stringify(d)); }
      if (first && !S.lastSeen) {             // 初めて開いた端末では NEW を出さない
        markSeen();
        if (!S.lastSeen) { var t = new Date(); S.lastSeen = today() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()); store('lastSeen', S.lastSeen); }
      }
      render();
      return ensureImages(neededBundles()).then(function (n) { if (n) render(); }, function () {});
    }, function (e) {
      S.loading = false;
      if (PWA && e && e.code === 'network') S.offline = true;
      if (stopForAuth(e)) {
        if (!S.data) { S.loadError = msg(e); render(); }
      }
      else if (!S.data) { S.loadError = msg(e); if (PWA && isStopCode(e && e.code)) stopForVersion(true); render(); }
      else if (PWA && e && e.code === 'network') render();   // 圏外：前回の内容のまま、帯だけ出す
      else if (PWA && isStopCode(e && e.code)) { stopForVersion(); render(); }   // 保存済みのリストは見せたまま、案内は1回だけ
      else { renderSync(); toast('読み込めませんでした：' + msg(e)); }
    });
  }
  // 合言葉・接続先の違いで止める。設定画面は一度だけ出す（出し直すと入力欄が空になる）。止めたら true
  function stopForAuth(e) {
    if (!PWA || !e || (e.code !== 'setup' && e.code !== 'auth')) return false;
    if (!S.authStopped) { S.authStopped = true; PWA.shell.showSetup(e.message ? e.message : undefined); }
    return true;
  }
  // データ置き場が古い・想定外の返事のとき：案内は1回だけ。reload か開き直しまで確認と送信を止める（操作は残す）
  function isStopCode(code) { return code === 'version' || code === 'fn' || code === 'unknown'; }
  function stopForVersion(silent) {
    if (S.versionStopped) return;
    S.versionStopped = true;
    if (!silent) toast('データ置き場の更新が必要です');
  }
  // サーバーの内容を受け取り、画面に出す S.data を作る（PWA では未送信の操作を重ねる）
  function setData(d) {
    S.server = d;
    S.data = PWA ? Object.assign({}, d, { entries: PWA.queue.applyQueue(d.entries, S.queue) }) : d;
  }
  function ls() { try { return localStorage; } catch (e) { return null; } }
  function stamp() { var t = new Date(); return today() + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()); }
  // 状態を変える。圏外（network）のときだけ、PWA は未送信の列にためて成功扱いにする
  function setStatus(id, status) {
    // 送信中の flush があれば、その終わり（S.queue と S.server の整理）を待ってから送る。重なると、
    // 送信済みの操作と打ち消し合って黙って消えたり、サーバーに着く順が入れ替わったりする
    var wait = PWA && S.flushing ? S.flushing.then(function () {}, function () {}) : null;
    var go = function () { return run('apiSetStatus', id, status); };
    return (wait ? wait.then(go) : go()).then(function (v) {
      dropQueued(id);   // いま送れた操作が、ためてあった古い操作に上書きされないように
      return v;
    }, function (e) {
      if (stopForAuth(e)) throw e;   // 合言葉の違いは設定画面へ（失敗の札は呼び出し側が出す）
      if (!PWA || !e || e.code !== 'network' || !S.server) throw e;
      var raw = S.server.entries.filter(function (x) { return x.id === id; })[0];
      if (!raw) throw e;
      var next = PWA.queue.enqueue(S.queue, { id: id, status: status, base: raw.status, at: stamp() });
      if (!PWA.queue.saveQueue(ls(), next)) throw e;   // 端末に残せないなら、今までどおり失敗として戻す
      S.queue = next; S.offline = true; setData(S.server);
    });
  }
  function dropQueued(id) {
    if (!PWA || !S.queue.some(function (op) { return op.id === id; })) return;
    S.queue = S.queue.filter(function (op) { return op.id !== id; });
    PWA.queue.saveQueue(ls(), S.queue);
    if (S.server) setData(S.server);
  }
  // ためた操作を古い順に送る。終わったら結果を画面とストレージに反映する
  function flush() {
    var sent = S.queue;
    S.busy++;
    var p = PWA.queue.flushQueue(sent, function (op) { return run('apiSetStatus', op.id, op.status); }).then(function (res) {
      S.busy--;
      var rest = res.queue;
      // 送っている最中に増えた操作を、残りに足す
      S.queue.filter(function (op) { return sent.indexOf(op) < 0; }).forEach(function (op) { rest = PWA.queue.enqueue(rest, op); });
      var open = {};
      rest.concat(res.dropped.map(function (d) { return d.op; })).forEach(function (op) { open[op.id] = true; });
      var patched = S.server && Object.assign({}, S.server, { entries: S.server.entries.map(function (x) {
        var op = sent.filter(function (o) { return o.id === x.id; })[0];
        return op && !open[x.id] ? Object.assign({}, x, { status: op.status, boughtAt: op.status === STATUS_BOUGHT ? op.at : '' }) : x;
      }) });
      S.queue = rest;
      PWA.queue.saveQueue(ls(), rest);
      if (patched) {
        setData(patched);
        if (sent.length) store('state', JSON.stringify(patched));   // 送れた分を反映した形を覚える（次に圏外で開いても古い表示にしない）
      }
      if (res.stopped === 'network') S.offline = true;
      if (res.dropped.length) toast('送れなかった操作を' + res.dropped.length + '件取り消しました');
      if (res.stopped === 'auth' || res.stopped === 'setup') stopForAuth({ code: res.stopped });
      else if (isStopCode(res.stopped)) stopForVersion();
      if (S.data) render();
    }, function (e) { S.busy--; throw e; });
    S.flushing = p;
    var clear = function () { if (S.flushing === p) S.flushing = null; };
    p.then(clear, clear);
    return p;
  }
  function poll() {
    if (S.busy || document.hidden || S.loading || S.authStopped || S.versionStopped) return;
    if (!S.data) { load(); return; }
    if (PWA && S.queue.length) { flush().then(load, load); return; }   // 先にためた操作を送ってから読み直す
    run('apiGetVersion').then(function (v) {
      if ((v !== S.version || S.offline) && !S.busy) load();
    }).catch(function (e) {
      if (stopForAuth(e)) return;   // 合言葉が途中で変わったとき
      if (PWA && e && isStopCode(e.code)) { stopForVersion(); return; }
      if (PWA && e && e.code === 'network' && !S.offline) { S.offline = true; render(); }
    });
  }
  // 保存して、終わったら全体を読み直す
  function act(promise, okMsg) {
    S.busy++;
    return promise.then(function (r) {
      S.busy--;
      if (typeof okMsg === 'function') okMsg = okMsg(r);
      if (okMsg) toast(okMsg);
      return load();
    }, function (e) {
      S.busy--;
      toast(PWA && e && e.code === 'network' ? '電波のあるところで使えます' : '保存できませんでした：' + msg(e));
      return load();
    });
  }
  function msg(e) { return (e && e.message) ? e.message : String(e); }

  // ---------- 画像 ----------
  // 画像の取り寄せ（カテゴリの束ごと、端末に覚える）
  function neededBundles() {
    var need = { cats: true };
    if (S.tab === 'add' && S.cat !== 'recent') need[S.cat] = true;
    if (S.tab === 'add' && S.q) searchItems(S.data.items, S.q).forEach(function (i) { need[i.categoryId] = true; });
    S.data.entries.forEach(function (x) { if (x.categoryId) need[x.categoryId] = true; });
    return Object.keys(need);
  }
  // 取り寄せた（端末から読んだものは除く）数を返す
  function ensureImages(names) {
    var v = S.data.imageVersion;
    var jobs = names.map(function (name) {
      if (S.images['__' + name] === v || S.fetching[name]) return null;
      var cached = null;
      try { cached = JSON.parse(store('img.' + name) || 'null'); } catch (e) {}
      if (cached && cached.v === v) { Object.assign(S.images, cached.images); S.images['__' + name] = v; return null; }
      S.fetching[name] = true;
      return run('apiGetImages', name).then(function (res) {
        Object.assign(S.images, res.images); S.images['__' + name] = res.version;
        store('img.' + name, JSON.stringify({ v: res.version, images: res.images }));  // 容量超えは store の catch で捨てる
      }).then(function () { delete S.fetching[name]; }, function () { delete S.fetching[name]; });
    }).filter(Boolean);
    var photoIds = [];
    S.data.entries.forEach(function (x) { if (x.photoId) photoIds.push(x.photoId); });
    S.data.items.forEach(function (i) { if (isPhotoKey(i.image)) photoIds.push(i.image); });
    photoIds = photoIds.filter(function (id, i) {
      if (photoIds.indexOf(id) !== i) return false;
      if (S.images[id] || S.fetching[id]) return false;
      var c = store('photo.' + id); if (c) { S.images[id] = c; return false; }
      return true;
    });
    if (photoIds.length) {
      photoIds.forEach(function (id) { S.fetching[id] = true; });
      jobs.push(run('apiGetPhotos', photoIds).then(function (m) {
        Object.keys(m).forEach(function (id) { S.images[id] = m[id]; store('photo.' + id, m[id]); });
      }).then(function () { photoIds.forEach(function (id) { delete S.fetching[id]; }); },
        function () { photoIds.forEach(function (id) { delete S.fetching[id]; }); }));
    }
    return Promise.all(jobs).then(function () { return jobs.length; });
  }
  function loadImagesThenRender() {
    if (!S.data) return;
    ensureImages(neededBundles()).then(function (n) { if (n) render(); }, function () {});
  }
  function itemById(id) { return id ? S.data.items.filter(function (i) { return i.id === id; })[0] : null; }
  // 1件の画像：写真 → 品物の絵 → カテゴリのアイコン の順に探す
  function imageFor(entryOrItem) {
    var key = entryOrItem.photoId || entryOrItem.image || '';
    if (!key && entryOrItem.itemId) {
      var it = itemById(entryOrItem.itemId);
      key = it ? it.image : '';
    }
    return S.images[key] || S.images['cat-' + entryOrItem.categoryId] || '';
  }
  function isPhoto(entryOrItem) {
    var key = entryOrItem.photoId || entryOrItem.image || '';
    return isPhotoKey(key) && !!S.images[key];
  }
  // 丸い画像。絵もアイコンも無ければ、品名の1文字目を出す
  // 画像として出してよい値か（data URL、または PWA の同梱画像 img/xxx.webp）
  function isImageSrc(src) { return /^data:image\//.test(src || '') || /^img\/[\w-]+\.webp$/.test(src || ''); }
  function pic(src, name, size, photo) {
    if (isImageSrc(src)) {
      return '<span class="pic ' + size + (photo ? ' photo' : '') + '"><img src="' + esc(src) + '" alt=""></span>';
    }
    return '<span class="pic ' + size + '">' + esc(String(name || '？').charAt(0)) + '</span>';
  }
  function picFor(x, size) { return pic(imageFor(x), x.name, size, isPhoto(x)); }

  // ---------- 小物 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(text) {
    var t = document.getElementById('toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  // 「チェックしました　元に戻す」を5秒。新しいものが来たら前の分は閉じる
  function undoToast(text, onUndo) {
    var u = document.getElementById('undo');
    document.getElementById('undo-text').textContent = text;
    undoToast.onUndo = onUndo;
    u.classList.add('show');
    clearTimeout(undoToast._t);
    undoToast._t = setTimeout(hideUndo, 5000);
  }
  function hideUndo() { undoToast.onUndo = null; document.getElementById('undo').classList.remove('show'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function catById(id) { return S.data.categories.filter(function (c) { return c.id === id; })[0] || null; }
  function sortedCats() { return S.data.categories.slice().sort(function (a, b) { return a.order - b.order; }); }
  function entryById(id) { return S.data.entries.filter(function (x) { return x.id === id; })[0] || null; }
  function todoEntries() {
    return S.data.entries.filter(function (x) { return x.status === STATUS_TODO; });
  }

  // NEW の「見た」の記録：今見えている最新の追加日時を覚える
  function markSeen() {
    if (!S.data) return;
    var m = maxAddedAt(S.data.entries);
    if (m && m > S.lastSeen) { S.lastSeen = m; store('lastSeen', m); }
  }

  // ---------- 描画 ----------
  function render() {
    var app = document.getElementById('app');
    var y = window.scrollY;
    // 検索欄に入力中なら、描き直したあとも入力を続けられるようにする
    var q = document.getElementById('q');
    var focused = q && document.activeElement === q ? { s: q.selectionStart, e: q.selectionEnd } : null;
    var cs = document.getElementById('cats'), cx = cs ? cs.scrollLeft : 0;   // カテゴリの横スクロールの位置も保つ
    app.innerHTML = S.tab === 'add' ? renderAdd() : renderList();
    document.getElementById('tabs').innerHTML =
      '<button data-a="tab" data-v="list" class="' + (S.tab === 'list' ? 'on' : '') + '">' + ICON.list + 'リスト</button>' +
      '<button data-a="tab" data-v="add" class="' + (S.tab === 'add' ? 'on' : '') + '">' + ICON.plus + '追加</button>';
    if (focused) { var n = document.getElementById('q'); if (n) { n.focus(); try { n.setSelectionRange(focused.s, focused.e); } catch (e) {} } }
    if (render.keepScroll) window.scrollTo(0, y);
    render.keepScroll = true;
    var c2 = document.getElementById('cats'); if (c2) c2.scrollLeft = cx;
  }
  // 帯の「読み込み中…」だけを直す（描き直さない）
  function renderSync() {
    var el = document.getElementById('sync');
    if (el) el.textContent = S.loading ? '読み込み中…' : '';
  }
  function syncText() { return S.loading ? '読み込み中…' : ''; }
  // 設定の歯車（PWA のときだけ）
  function offlineBand() { return PWA && S.offline ? '<div class="offline">圏外：前回の内容を表示中</div>' : ''; }
  function gearHtml() {
    return PWA ? '<button class="gear" data-a="settings" aria-label="設定">' + ICON.gear + '</button>' : '';
  }

  function renderList() {
    if (!S.data) {
      return '<header class="hero"><div class="hero-top"><h1>買うもの</h1><span class="sync" id="sync">' +
        (S.loadError ? '' : '読み込み中…') + '</span>' + gearHtml() + '</div></header>' +
        (S.loadError ? '<main><div class="empty"><b>読み込めませんでした</b>' + esc(S.loadError) + '</div></main>' : '');
    }
    var todo = todoEntries();
    // チェック直後の行は、状態を「買う」として並べる（取り消し線で出す）
    var shown = S.data.entries.filter(function (x) { return x.status === STATUS_TODO || S.pendingDone[x.id]; })
      .map(function (x) { return x.status === STATUS_TODO ? x : Object.assign({}, x, { status: STATUS_TODO }); });
    var n = todo.filter(function (x) { return !S.pendingDone[x.id]; }).length;
    var h = '<header class="hero tall"><div class="hero-top"><h1>買うもの<b>' + n + '</b>件</h1><span class="sync" id="sync">' + syncText() + '</span>' + gearHtml() + '</div>' + offlineBand() + '</header>';
    var sorts = '<div class="sorts">' + SORTS.map(function (s) {
      return '<button data-a="sort" data-v="' + s[0] + '" class="' + (S.sort === s[0] ? 'on' : '') + '">' + esc(s[1]) + '</button>';
    }).join('') + '</div>';
    if (!shown.length) {
      return h + sorts + '<main><div class="empty"><b>買うものはありません</b>切れた物・減ってきた物を足しておきましょう' +
        '<div><button class="btn primary small" data-a="tab" data-v="add">追加する</button></div></div></main>';
    }
    var t = today();
    var groups = groupEntries(shown, S.sort, S.data.categories).map(function (g) {
      return '<div class="group">' + (g.title ? '<h3>' + esc(g.title) + '<small>' + g.entries.length + '件</small></h3>' : '') +
        '<div class="list">' + g.entries.map(function (x) { return rowHtml(x, t); }).join('') + '</div></div>';
    }).join('');
    return h + sorts + '<main>' + groups + '</main>';
  }

  function rowHtml(x, t) {
    var pend = !!S.pendingDone[x.id];
    return '<div class="row' + (pend ? ' pend' : '') + '" data-a="' + (pend ? 'noop' : 'edit') + '" data-id="' + esc(x.id) + '">' +
      picFor(x, 's56') +
      '<div class="txt"><div class="nm">' + (x.urgent ? '<span class="tag urgent">急ぎ</span>' : '') + esc(x.name) +
      (x.qty ? '<span class="qty">× ' + esc(x.qty) + '</span>' : '') +
      (isNew(x, S.lastSeen, DEVICE) ? '<span class="tag new">NEW</span>' : '') +
      (x.unsent ? '<span class="tag unsent">未送信</span>' : '') + '</div>' +
      '<div class="foot"><span class="memo">' + esc(x.memo) + '</span><span class="date">' + esc(addedLabel(x.addedAt, t)) + '</span></div></div>' +
      '<button class="chk" data-a="' + (pend ? 'noop' : 'check') + '" data-id="' + esc(x.id) + '" aria-label="買った">' + ICON.check + '</button></div>';
  }

  function renderAdd() {
    var h = '<header class="hero tall"><div class="hero-top"><h1>追加</h1><span class="sync" id="sync">' + syncText() + '</span>' + gearHtml() + '</div>' + offlineBand() +
      '<div class="search">' + ICON.search + '<input id="q" type="text" enterkeyhint="search" placeholder="品名で探す（ひらがなでも）" autocomplete="off" value="' + esc(S.q) + '">' +
      (S.q ? '<button class="clear" data-a="clear-q" aria-label="消す">✕</button>' : '') + '</div></header>';
    if (!S.data) return h;
    var cats = '<div class="cats" id="cats"><button class="cat' + (S.cat === 'recent' && !S.q ? ' on' : '') + '" data-a="cat" data-v="recent">' +
      '<div class="ring">' + ICON.clock + '</div><div class="name">最近買った</div></button>' +
      sortedCats().map(function (c) {
        var src = S.images['cat-' + c.id];
        var inner = isImageSrc(src) ? '<img src="' + esc(src) + '" alt="">' : '<span class="ph">' + esc(c.name.charAt(0)) + '</span>';
        return '<button class="cat' + (S.cat === c.id && !S.q ? ' on' : '') + '" data-a="cat" data-v="' + esc(c.id) + '">' +
          '<div class="ring">' + inner + '</div><div class="name">' + esc(c.name).replace(/・/g, '・<wbr>') + '</div></button>';
      }).join('') + '</div>';
    var body;
    if (S.q) {
      var hits = searchItems(S.data.items, S.q);
      body = '<div class="grid-title">「' + esc(S.q) + '」<small>' + hits.length + '件</small></div>' +
        '<div class="grid">' + hits.map(itemCard).join('') + plusCard(S.q) + '</div>' +
        (hits.length ? '' : '<p class="note">見つかりません。「＋手入力」から足せます</p>');
    } else if (S.cat === 'recent') {
      var recent = recentBought(S.data.entries, 30);
      body = '<div class="grid-title">最近買った<small>押すともう一度入れられます</small></div>' +
        (recent.length ? '<div class="grid">' + recent.map(recentCard).join('') + '</div>'
          : '<p class="note">まだ買った物はありません。上のカテゴリから選んでください</p>');
    } else {
      var cat = catById(S.cat);
      var items = S.data.items.filter(function (i) { return i.categoryId === S.cat; }).sort(function (a, b) { return a.order - b.order; });
      body = '<div class="grid-title">' + esc(cat ? cat.name : '') + '<small>' + items.length + '品</small></div>' +
        '<div class="grid">' + items.map(itemCard).join('') + plusCard('') + '</div>';
    }
    return h + cats + '<main>' + body + '</main>';
  }
  function itemCard(it) {
    var a = findActive(S.data.entries, it.id);
    return '<button class="card' + (a ? ' listed' : '') + '" data-a="item" data-id="' + esc(it.id) + '">' +
      (a ? '<span class="badge">リスト済</span>' : '') + picFor(it, 's64') + '<span class="nm">' + esc(it.name) + '</span></button>';
  }
  function recentCard(x) {
    var a = findActive(S.data.entries, x.itemId);
    return '<button class="card' + (a ? ' listed' : '') + '" data-a="recent" data-id="' + esc(x.id) + '">' +
      (a ? '<span class="badge">リスト済</span>' : '') + (x.unsent ? '<span class="badge unsent">未送信</span>' : '') + picFor(x, 's64') + '<span class="nm">' + esc(x.name) + '</span></button>';
  }
  function plusCard(name) {
    return '<button class="card plus" data-a="custom" data-name="' + esc(name) + '"><span class="pic s64">＋</span><span class="nm">手入力</span></button>';
  }

  // ---------- 下からのシート ----------
  function openSheet(sheet) {
    S.sheet = sheet;
    renderSheet();
    document.getElementById('sheet').classList.add('show');
    document.getElementById('backdrop').classList.add('show');
  }
  function closeSheet() {
    S.sheet = null;
    document.getElementById('sheet').classList.remove('show');
    document.getElementById('backdrop').classList.remove('show');
  }
  function field(label, html) { return '<div class="field"><span class="lb">' + esc(label) + '</span>' + html + '</div>'; }
  function qtyMemoUrgent(f) {
    return '<div class="two">' +
      field('数量', '<input class="input" id="f-qty" maxlength="10" placeholder="例：2パック" value="' + esc(f.qty) + '">') +
      field('急ぎ', '<button class="toggle' + (f.urgent ? ' on' : '') + '" data-a="toggle-urgent">' + (f.urgent ? '急ぎ' : '急がない') + '</button>') +
      '</div>' + field('メモ', '<input class="input" id="f-memo" maxlength="60" placeholder="例：特売なら2つ" value="' + esc(f.memo) + '">');
  }
  function renderSheet() {
    var f = S.sheet, el = document.getElementById('sheet');
    if (!f) return;
    var html = '<div class="grip"></div><button class="close" data-a="close" aria-label="閉じる">' + ICON.close + '</button>';
    if (f.kind === 'add') {
      html += '<div class="head">' + picFor(f.item, 's88') + '<h4>' + esc(f.item.name) + '</h4></div>' + qtyMemoUrgent(f) +
        '<div class="actions"><button class="btn primary" data-a="submit-add"' + (f.saving ? ' disabled' : '') + '>リストに入れる</button></div>';
    } else if (f.kind === 'edit') {
      html += '<div class="head">' + picFor(f.entry, 's88') + '<h4>' + esc(f.entry.name) + '</h4></div>';
      if (f.confirm) {
        html += '<div class="confirm"><p>リストから外しますか？</p><div class="two">' +
          '<button class="btn primary" data-a="cancel-yes"' + (f.saving ? ' disabled' : '') + '>はい</button>' +
          '<button class="btn text" style="margin:0;background:var(--tile)" data-a="cancel-no">いいえ</button></div></div>';
      } else {
        html += qtyMemoUrgent(f) +
          '<div class="actions"><button class="btn primary" data-a="submit-edit"' + (f.saving ? ' disabled' : '') + '>保存</button>' +
          '<button class="btn text" data-a="ask-cancel">やっぱり要らない</button></div>';
      }
    } else if (f.kind === 'custom') {
      var photoSrc = f.photo || S.images[f.photoId] || '';
      var photo = photoSrc
        ? '<div class="photo-line">' + pic(photoSrc, f.name, 's64', true) + '<button class="link" data-a="photo-remove">写真を外す</button></div>'
        : '<div><label class="photo-btn">' + ICON.camera + '写真を付ける<input type="file" id="f-photo" accept="image/*"></label></div>';
      html += '<div class="head"><h4>手入力で足す</h4></div>' +
        field('品名（必須）', '<input class="input" id="f-name" maxlength="40" placeholder="例：キッチンペーパー" value="' + esc(f.name) + '">') +
        field('カテゴリ', '<select class="input" id="f-cat">' + sortedCats().map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (c.id === f.categoryId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('') + '</select>') +
        field('写真（なくてもよい）', photo) + qtyMemoUrgent(f) +
        '<label class="check-line"><input type="checkbox" id="f-register"' + (f.register ? ' checked' : '') + '>一覧にも登録する</label>' +
        '<div class="actions"><button class="btn primary" data-a="submit-custom"' + (f.saving ? ' disabled' : '') + '>リストに入れる</button></div>';
    }
    el.innerHTML = html;
  }
  // シートの入力欄の値を S.sheet に写す（描き直す前に呼ぶ）
  function readSheet() {
    var f = S.sheet;
    if (!f) return;
    var g = function (id) { var e = document.getElementById(id); return e ? e : null; };
    if (g('f-qty')) f.qty = g('f-qty').value;
    if (g('f-memo')) f.memo = g('f-memo').value;
    if (g('f-name')) f.name = g('f-name').value;
    if (g('f-cat')) f.categoryId = g('f-cat').value;
    if (g('f-register')) f.register = g('f-register').checked;
  }

  function openAdd(it) {
    var a = findActive(S.data.entries, it.id);
    if (a) { openEdit(a.id); return; }
    openSheet({ kind: 'add', item: it, qty: '', memo: '', urgent: false });
  }
  function openEdit(id) {
    var x = entryById(id);
    if (!x) return;
    openSheet({ kind: 'edit', entry: x, qty: x.qty, memo: x.memo, urgent: !!x.urgent, confirm: false });
  }
  function openCustom(pre) {
    pre = pre || {};
    var first = sortedCats()[0];
    var catId = pre.categoryId && catById(pre.categoryId) ? pre.categoryId : (S.cat !== 'recent' && catById(S.cat) ? S.cat : (first ? first.id : ''));
    openSheet({ kind: 'custom', name: pre.name || '', categoryId: catId, photo: null, photoId: pre.photoId || '', qty: '', memo: '', urgent: false, register: false });
  }

  function submitAdd() {
    var f = S.sheet; readSheet();
    f.saving = true; renderSheet();
    act(run('apiAdd', { itemId: f.item.id, categoryId: f.item.categoryId, qty: f.qty, memo: f.memo, urgent: f.urgent, device: DEVICE }),
      function (r) { return r && r.existing ? 'すでにリストにあります' : '「' + f.item.name + '」を入れました'; });
    closeSheet();
  }
  function submitCustom() {
    var f = S.sheet; readSheet();
    if (!f.name.trim()) { toast('品名を入れてください'); return; }
    if (!f.categoryId) { toast('カテゴリを選んでください'); return; }
    f.saving = true; renderSheet();
    var x = { name: f.name, categoryId: f.categoryId, qty: f.qty, memo: f.memo, urgent: f.urgent, device: DEVICE, photoId: f.photo ? '' : f.photoId };
    act(run('apiAddCustom', x, f.photo || null, !!f.register), '「' + f.name.trim() + '」を入れました');
    closeSheet();
  }
  function submitEdit() {
    var f = S.sheet; readSheet();
    f.saving = true; renderSheet();
    act(run('apiUpdate', f.entry.id, { qty: f.qty, memo: f.memo, urgent: f.urgent }), '保存しました');
    closeSheet();
  }
  function cancelEntry() {
    var f = S.sheet;
    f.saving = true; renderSheet();
    act(run('apiSetStatus', f.entry.id, STATUS_CANCEL), '「' + f.entry.name + '」を外しました');
    closeSheet();
  }

  // ---------- チェックと「元に戻す」 ----------
  function check(id) {
    var x = entryById(id);
    if (!x) return;
    S.pendingDone[id] = true; render();
    S.busy++;
    function dec() { S.busy--; }
    var saved = setStatus(id, STATUS_BOUGHT).then(function (v) { if (v) S.version = v; })
      .catch(function (e) { delete S.pendingDone[id]; toast('保存できませんでした：' + msg(e)); render(); })
      .then(dec, dec);
    undoToast('「' + x.name + '」をチェックしました', function () {
      delete S.pendingDone[id];
      render();
      // チェックの保存が終わってから戻す（順番が入れ替わらないように）
      act(saved.then(function () { return setStatus(id, STATUS_TODO); }));
    });
    setTimeout(function () {
      if (S.pendingDone[id]) { delete S.pendingDone[id]; saved.then(function () { return load(); }); }
    }, 5000);
  }

  // ---------- タブ ----------
  function goTab(tab) {
    if (tab === S.tab) { window.scrollTo(0, 0); return; }
    if (S.tab === 'list') markSeen();
    S.tab = tab;
    render.keepScroll = false;
    render(); window.scrollTo(0, 0);
    loadImagesThenRender();
  }

  // ---------- 操作 ----------
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-a]');
    if (!el) { if (ev.target.id === 'backdrop') closeSheet(); return; }
    var a = el.dataset.a, id = el.dataset.id;
    if (a === 'noop') return;
    if (a === 'settings') { if (PWA) PWA.shell.openSettings(); return; }
    if (a === 'tab') goTab(el.dataset.v);
    else if (a === 'sort') { S.sort = el.dataset.v; store('sort', S.sort); render(); }
    else if (a === 'check') check(id);
    else if (a === 'edit') openEdit(id);
    else if (a === 'undo') { var fn = undoToast.onUndo; hideUndo(); if (fn) fn(); }
    else if (a === 'cat') {
      S.cat = el.dataset.v; S.q = '';
      render(); loadImagesThenRender();
    } else if (a === 'clear-q') { S.q = ''; render(); document.getElementById('q').focus(); }
    else if (a === 'item') { var it = itemById(id); if (it) openAdd(it); }
    else if (a === 'recent') {
      var x = entryById(id);
      if (!x) return;
      var item = itemById(x.itemId);
      if (item) openAdd(item);
      else openCustom({ name: x.name, categoryId: x.categoryId, photoId: x.photoId });
    } else if (a === 'custom') openCustom({ name: el.dataset.name || '' });
    else if (a === 'close') closeSheet();
    else if (a === 'toggle-urgent') {
      S.sheet.urgent = !S.sheet.urgent;
      el.classList.toggle('on', S.sheet.urgent); el.textContent = S.sheet.urgent ? '急ぎ' : '急がない';
    } else if (a === 'submit-add') { if (!S.sheet.saving) submitAdd(); }
    else if (a === 'submit-custom') { if (!S.sheet.saving) submitCustom(); }
    else if (a === 'submit-edit') { if (!S.sheet.saving) submitEdit(); }
    else if (a === 'ask-cancel') { readSheet(); S.sheet.confirm = true; renderSheet(); }
    else if (a === 'cancel-no') { S.sheet.confirm = false; renderSheet(); }
    else if (a === 'cancel-yes') { if (!S.sheet.saving) cancelEntry(); }
    else if (a === 'photo-remove') { readSheet(); S.sheet.photo = null; S.sheet.photoId = ''; renderSheet(); }
  });

  // 写真の縮小（160px 四方の JPEG、45,000文字以下）
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var s = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = 160;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 160, 160);
        var q = 0.7, url = c.toDataURL('image/jpeg', q);
        while (url.length > 45000 && q > 0.3) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
        URL.revokeObjectURL(img.src);
        url.length > 45000 ? reject(new Error('写真が大きすぎます')) : resolve(url);
      };
      img.onerror = function () { reject(new Error('写真を読めませんでした')); };
      img.src = URL.createObjectURL(file);
    });
  }
  document.addEventListener('change', function (ev) {
    if (ev.target.id !== 'f-photo' || !S.sheet) return;
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    readSheet();
    var sheet = S.sheet;
    shrinkPhoto(file).then(function (url) {
      if (S.sheet !== sheet) return;
      readSheet(); sheet.photo = url; sheet.photoId = ''; renderSheet();
    }, function (e) { toast(msg(e)); });
  });

  // 検索：入力のたびに描き直す（かな漢字変換の途中は待つ）
  function onSearch(ev) {
    if (ev.target.id !== 'q' || ev.isComposing) return;
    S.q = ev.target.value;
    render();
    loadImagesThenRender();
  }
  document.addEventListener('input', onSearch);
  document.addEventListener('compositionend', onSearch);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (S.tab === 'list') markSeen(); }
    else poll();
  });
  setInterval(poll, 5000);
  if (PWA) window.addEventListener('online', poll);   // 電波が戻ったら、5秒待たずに送る・読み直す

  // PWA の設定画面が、読み直しや「いま触っても安全か」を問い合わせる口
  window.KaimonoApp = {
    // つなぎ直したあと：止めていた確認を再開し、ためた操作を先に送ってから読み直す
    reload: function () {
      S.authStopped = false; S.versionStopped = false;
      return (PWA && S.queue.length && !S.busy ? flush() : Promise.resolve()).then(load, load);
    },
    isBusy: function () {
      return !!(S.sheet || S.busy || S.queue.length);
    }
  };

  // PWA：前回の内容と未送信の操作を先に読んで、圏外でもすぐ描く
  if (PWA) {
    S.queue = PWA.queue.loadQueue(ls());
    try {
      var cached = JSON.parse(store('state') || 'null');
      if (cached && Array.isArray(cached.entries)) { setData(cached); S.version = cached.version; }
    } catch (e) {}
  }
  render();
  load();
})();
