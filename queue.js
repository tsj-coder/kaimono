var KaimonoQueue = (function () {
  var QUEUE_KEY = 'kaimono.queue';

  function enqueue(queue, op) {
    var previous = queue.find(function (item) { return item.id === op.id; });
    var next = Object.assign({}, op, { base: previous ? previous.base : op.base });
    if (next.status === next.base) {
      return queue.filter(function (item) { return item.id !== op.id; });
    }
    if (!previous) return queue.concat([next]);
    return queue.map(function (item) { return item.id === op.id ? next : item; });
  }

  function applyQueue(entries, queue) {
    return entries.map(function (entry) {
      var op = queue.find(function (item) { return item.id === entry.id; });
      if (!op) return entry;
      return Object.assign({}, entry, {
        status: op.status,
        boughtAt: op.status === '買った' ? op.at : '',
        unsent: true,
      });
    });
  }

  async function flushQueue(queue, send) {
    var dropped = [];
    for (var i = 0; i < queue.length; i++) {
      try {
        await send(queue[i]);
      } catch (error) {
        var code = error && error.code;
        // 捨てるのは GAS が「成り立たない」と返した error だけ。fn や code なしは想定外なので止めて残す。
        if (code === 'error') {
          dropped.push({ op: queue[i], error: error });
          continue;
        }
        var known = ['network', 'auth', 'version', 'setup', 'fn'].indexOf(code) >= 0;
        return { queue: queue.slice(i), dropped: dropped, stopped: known ? code : 'unknown' };
      }
    }
    return { queue: [], dropped: dropped, stopped: '' };
  }

  function loadQueue(storage) {
    try {
      var queue = JSON.parse(storage.getItem(QUEUE_KEY));
      return Array.isArray(queue) ? queue : [];
    } catch (e) {
      return [];
    }
  }

  function saveQueue(storage, queue) {
    try {
      storage.setItem(QUEUE_KEY, JSON.stringify(queue));
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    enqueue: enqueue, applyQueue: applyQueue, flushQueue: flushQueue,
    loadQueue: loadQueue, saveQueue: saveQueue,
  };
}());

if (typeof window !== 'undefined') window.KaimonoQueue = KaimonoQueue;
if (typeof module !== 'undefined') module.exports = KaimonoQueue;
