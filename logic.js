// 買い物リスト：並べ方・検索・最近買った・NEW・二重登録・入力の整え。
// GAS（Code.js から呼ぶ）・画面（index.html に埋め込む）・node のテストで共用。スプレッドシートにも画面にも依存しない。

var STATUS_TODO = '買う';
var STATUS_BOUGHT = '買った';
var STATUS_CANCEL = '取り消し';
var STATUSES = [STATUS_TODO, STATUS_BOUGHT, STATUS_CANCEL];
var PHOTO_MAX = 45000;

function normalizeKana(s) {
  return String(s == null ? '' : s)
    .replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); })
    .replace(/\s+/g, '').toLowerCase();
}

function searchItems(items, q) {
  var n = normalizeKana(q);
  if (!n) return [];
  return items.filter(function (it) {
    return !it.hidden && (normalizeKana(it.name).indexOf(n) >= 0 || normalizeKana(it.yomi).indexOf(n) >= 0);
  });
}

function byAddedAsc_(a, b) { return a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0; }
function byBoughtDesc_(a, b) { return a.boughtAt < b.boughtAt ? 1 : a.boughtAt > b.boughtAt ? -1 : 0; }

function groupEntries(entries, mode, categories) {
  var todo = entries.filter(function (x) { return x.status === STATUS_TODO; }).sort(byAddedAsc_);
  var groups;
  if (mode === 'old') {
    groups = [{ title: '', entries: todo }];
  } else if (mode === 'urgent') {
    groups = [
      { title: '急ぎ', entries: todo.filter(function (x) { return x.urgent; }) },
      { title: 'そのほか', entries: todo.filter(function (x) { return !x.urgent; }) },
    ];
  } else {
    var cats = categories.slice().sort(function (a, b) { return a.order - b.order; });
    var ids = cats.map(function (c) { return c.id; });
    groups = cats.map(function (c) {
      return { title: c.name, entries: todo.filter(function (x) { return x.categoryId === c.id; }) };
    });
    groups.push({ title: '分類なし', entries: todo.filter(function (x) { return ids.indexOf(x.categoryId) < 0; }) });
  }
  return groups.filter(function (g) { return g.entries.length > 0; });
}

function recentBought(entries, limit) {
  var seen = {};
  var out = [];
  entries.filter(function (x) { return x.status === STATUS_BOUGHT; }).sort(byBoughtDesc_).forEach(function (x) {
    var k = x.itemId ? 'i:' + x.itemId : 'n:' + x.name;
    if (seen[k] || out.length >= limit) return;
    seen[k] = true;
    out.push(x);
  });
  return out;
}

function isNew(entry, lastSeen, deviceId) {
  return !!lastSeen && entry.status === STATUS_TODO && entry.addedAt > lastSeen && entry.device !== deviceId;
}

function findActive(entries, itemId) {
  if (!itemId) return null;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].itemId === itemId && entries[i].status === STATUS_TODO) return entries[i];
  }
  return null;
}

function addedLabel(addedAt, today) {
  var a = String(addedAt).slice(0, 10).split('-').map(Number);
  var t = String(today).split('-').map(Number);
  var days = Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5);
  var when = days <= 0 ? '今日' : days === 1 ? '昨日' : days + '日前';
  return a[1] + '/' + a[2] + '（' + when + '）';
}

function entriesForClient(entries, boughtLimit) {
  var todo = entries.filter(function (x) { return x.status === STATUS_TODO; });
  var bought = entries.filter(function (x) { return x.status === STATUS_BOUGHT; }).sort(byBoughtDesc_).slice(0, boughtLimit);
  return todo.concat(bought);
}

function maxAddedAt(entries) {
  var m = '';
  entries.forEach(function (x) { if (x.status === STATUS_TODO && x.addedAt > m) m = x.addedAt; });
  return m;
}

function cleanEntry(x) {
  x = x || {};
  var itemId = String(x.itemId || '').trim();
  var name = String(x.name || '').trim().slice(0, 40);
  var categoryId = String(x.categoryId || '').trim();
  var device = String(x.device || '').trim();
  if (!itemId && !name) throw new Error('品名を入れてください');
  if (itemId && !/^[\w-]{1,30}$/.test(itemId)) throw new Error('品物idが不正です');
  if (!/^[\w-]{1,20}$/.test(categoryId)) throw new Error('カテゴリが不正です');
  if (!/^[\w-]{1,40}$/.test(device)) throw new Error('端末idが不正です');
  return {
    itemId: itemId, name: name, categoryId: categoryId,
    qty: String(x.qty || '').trim().slice(0, 10), memo: String(x.memo || '').trim().slice(0, 60),
    urgent: !!x.urgent, device: device,
  };
}

// 写真id（Code.js の newId_('p') 由来）かどうか。用意した絵の品物id（例 p01）は p で始まるが対象外。
function isPhotoKey(k) {
  var s = String(k == null ? '' : k);
  return /^p/.test(s) && !/^[a-z]\d{2}$/.test(s);
}

function cleanPhoto(dataUrl) {
  var s = String(dataUrl || '');
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s)) throw new Error('写真の形式が不正です');
  if (s.length > PHOTO_MAX) throw new Error('写真が大きすぎます');
  return s;
}

if (typeof module !== 'undefined') {
  module.exports = {
    STATUS_TODO: STATUS_TODO, STATUS_BOUGHT: STATUS_BOUGHT, STATUS_CANCEL: STATUS_CANCEL, STATUSES: STATUSES,
    normalizeKana: normalizeKana, searchItems: searchItems, groupEntries: groupEntries, recentBought: recentBought,
    isNew: isNew, findActive: findActive, addedLabel: addedLabel, entriesForClient: entriesForClient,
    maxAddedAt: maxAddedAt, cleanEntry: cleanEntry, cleanPhoto: cleanPhoto, isPhotoKey: isPhotoKey,
  };
}
