/**
 * 时间胶囊格式：扩展侧（require）与回放页面（script）共用的纯函数。
 *
 * 胶囊是 NDJSON：首行 meta，其后是事件。事件统一使用相对录制开始的毫秒数 t。
 *   e   文本增量 {t,k:"e",len,c:[{s,e,x}]}，c 相对事件前文档，按 s 降序应用
 *   cur 光标/选区 {t,k:"cur",a,b}
 *   cp  全文检查点 {t,k:"cp",text}
 *   m   标记 {t,k:"m",name,label,detail}
 *
 * 这里不依赖 vscode / node，浏览器可直接通过 <script> 使用 XmuojCapsule。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.XmuojCapsule = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var FORMAT = "xmuoj.capsule";
  var VERSION = 1;
  var DEFAULT_IDLE_THRESHOLD_MS = 3000;
  var DEFAULT_IDLE_COMPRESSED_MS = 1000;

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function normalizeCursor(cursor, textLength) {
    var a = cursor && isFiniteNumber(cursor.a) ? Math.round(cursor.a) : 0;
    var b = cursor && isFiniteNumber(cursor.b) ? Math.round(cursor.b) : a;
    a = Math.max(0, Math.min(textLength, a));
    b = Math.max(0, Math.min(textLength, b));
    return { a: a, b: b };
  }

  /**
   * 应用一次文本增量。changes 的偏移都相对同一个旧文档，
   * 因此必须按起点降序替换，才不会让前面的偏移失效。
   */
  function applyChanges(text, changes) {
    var base = typeof text === "string" ? text : "";
    if (!Array.isArray(changes) || changes.length === 0) {
      return { ok: true, text: base };
    }
    var sorted = [];
    for (var i = 0; i < changes.length; i += 1) {
      var change = changes[i] || {};
      var start = change.s;
      var end = change.e;
      if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
        return { ok: false, text: base, error: "补丁缺少有效偏移" };
      }
      start = Math.round(start);
      end = Math.round(end);
      if (start < 0 || end < start || end > base.length) {
        return { ok: false, text: base, error: "补丁偏移越界" };
      }
      sorted.push({ s: start, e: end, x: typeof change.x === "string" ? change.x : "" });
    }
    sorted.sort(function (a, b) {
      return b.s - a.s || b.e - a.e;
    });
    var out = base;
    var previousStart = base.length + 1;
    for (var j = 0; j < sorted.length; j += 1) {
      var item = sorted[j];
      if (item.e > previousStart) {
        return { ok: false, text: base, error: "补丁区间重叠" };
      }
      out = out.slice(0, item.s) + item.x + out.slice(item.e);
      previousStart = item.s;
    }
    return { ok: true, text: out };
  }

  /**
   * 在给定状态上应用一个事件。返回新的状态，不修改入参。
   * state: {text, cursor:{a,b}, time}
   */
  function applyEvent(state, event) {
    var current = state || {};
    var text = typeof current.text === "string" ? current.text : "";
    var cursor = normalizeCursor(current.cursor, text.length);
    var time = isFiniteNumber(current.time) ? current.time : 0;
    var next = { text: text, cursor: cursor, time: time };
    if (!event || typeof event !== "object") {
      return { ok: true, text: next.text, cursor: next.cursor, time: next.time };
    }
    if (isFiniteNumber(event.t)) {
      next.time = event.t;
    }
    if (event.k === "e") {
      if (isFiniteNumber(event.len) && event.len !== text.length) {
        return { ok: false, text: text, cursor: cursor, time: next.time, error: "事件长度与当前文本不一致" };
      }
      var applied = applyChanges(text, event.c);
      if (!applied.ok) {
        return { ok: false, text: text, cursor: cursor, time: next.time, error: applied.error };
      }
      next.text = applied.text;
      next.cursor = normalizeCursor(cursor, next.text.length);
    } else if (event.k === "cur") {
      next.cursor = normalizeCursor({ a: event.a, b: event.b }, text.length);
    } else if (event.k === "cp") {
      next.text = typeof event.text === "string" ? event.text : "";
      next.cursor = normalizeCursor(cursor, next.text.length);
    }
    return { ok: true, text: next.text, cursor: next.cursor, time: next.time };
  }

  /** 顺序应用事件；默认截止到 upToTime（含）。 */
  function applyEventsTo(baseText, events, options) {
    var opts = options || {};
    var upToTime = isFiniteNumber(opts.upToTime) ? opts.upToTime : Infinity;
    var state = {
      text: typeof baseText === "string" ? baseText : "",
      cursor: opts.cursor || { a: 0, b: 0 },
      time: 0
    };
    var list = Array.isArray(events) ? events : [];
    for (var i = 0; i < list.length; i += 1) {
      var event = list[i];
      if (!event || (isFiniteNumber(event.t) && event.t > upToTime)) {
        break;
      }
      var result = applyEvent(state, event);
      if (!result.ok) {
        return { ok: false, text: state.text, cursor: state.cursor, time: state.time, failedAt: i, error: result.error };
      }
      state = { text: result.text, cursor: result.cursor, time: result.time };
    }
    return { ok: true, text: state.text, cursor: state.cursor, time: state.time };
  }

  /**
   * 找到 time 之前（含）最近的检查点。
   * 返回 {index, time, text}；没有检查点时返回 null。
   */
  function findCheckpoint(events, time) {
    var list = Array.isArray(events) ? events : [];
    var found = null;
    for (var i = 0; i < list.length; i += 1) {
      var event = list[i];
      if (!event) {
        continue;
      }
      if (isFiniteNumber(event.t) && isFiniteNumber(time) && event.t > time) {
        break;
      }
      if (event.k === "cp") {
        found = { index: i, time: isFiniteNumber(event.t) ? event.t : 0, text: typeof event.text === "string" ? event.text : "" };
      }
    }
    return found;
  }

  /**
   * 重建 time（含）时刻的文档状态。先跳到最近检查点，再只应用其后的事件。
   * 返回 {text, cursor, time, checkpoint, markers}。
   */
  function sliceAt(events, time) {
    var list = Array.isArray(events) ? events : [];
    var target = isFiniteNumber(time) ? time : Infinity;
    var checkpoint = findCheckpoint(list, target);
    var startIndex = checkpoint ? checkpoint.index + 1 : 0;
    var result = applyEventsTo(checkpoint ? checkpoint.text : "", list.slice(startIndex), {
      upToTime: target,
      cursor: checkpoint ? undefined : { a: 0, b: 0 }
    });
    var markers = [];
    for (var i = 0; i < list.length; i += 1) {
      var event = list[i];
      if (!event) {
        continue;
      }
      if (isFiniteNumber(event.t) && event.t > target) {
        break;
      }
      if (event.k === "m") {
        markers.push(event);
      }
    }
    return {
      ok: result.ok,
      text: result.text,
      cursor: result.cursor,
      time: result.time,
      checkpoint: checkpoint ? { index: checkpoint.index, time: checkpoint.time } : null,
      markers: markers,
      error: result.error || ""
    };
  }

  /**
   * 压缩长时间停顿：相邻事件间隔超过 thresholdMs 时只保留 compressedMs。
   * 返回新事件列表与分段映射，供时间轴在“真实时间/压缩时间”之间换算。
   */
  function remapIdle(events, options) {
    var opts = options || {};
    var thresholdMs = isFiniteNumber(opts.thresholdMs) ? opts.thresholdMs : DEFAULT_IDLE_THRESHOLD_MS;
    var compressedMs = isFiniteNumber(opts.compressedMs) ? opts.compressedMs : DEFAULT_IDLE_COMPRESSED_MS;
    var list = (Array.isArray(events) ? events : []).slice().sort(function (a, b) {
      return (isFiniteNumber(a && a.t) ? a.t : 0) - (isFiniteNumber(b && b.t) ? b.t : 0);
    });
    var mapped = [];
    var segments = [];
    var previousReal = null;
    var previousMapped = 0;
    for (var i = 0; i < list.length; i += 1) {
      var event = list[i] || {};
      var realTime = isFiniteNumber(event.t) ? event.t : previousReal || 0;
      var nextTime;
      if (previousReal === null) {
        nextTime = 0;
        if (realTime > 0) {
          segments.push({ fromReal: 0, toReal: realTime, fromMapped: 0, toMapped: 0, idleMs: realTime });
        }
      } else {
        var gap = Math.max(0, realTime - previousReal);
        var step = gap > thresholdMs ? compressedMs : gap;
        nextTime = previousMapped + step;
        if (gap > thresholdMs) {
          segments.push({
            fromReal: previousReal,
            toReal: realTime,
            fromMapped: previousMapped,
            toMapped: nextTime,
            idleMs: gap
          });
        }
      }
      var copy = {};
      for (var key in event) {
        if (Object.prototype.hasOwnProperty.call(event, key)) {
          copy[key] = event[key];
        }
      }
      copy.t = nextTime;
      mapped.push(copy);
      previousReal = realTime;
      previousMapped = nextTime;
    }
    return {
      events: mapped,
      durationMs: previousMapped,
      realDurationMs: previousReal === null ? 0 : previousReal,
      segments: segments
    };
  }

  /** 校验首行 meta；只关心能否安全读取与回放。 */
  function validateCapsule(meta) {
    if (!meta || typeof meta !== "object") {
      return { ok: false, error: "缺少胶囊元数据" };
    }
    if (meta.format !== FORMAT) {
      return { ok: false, error: "不是 XMUOJ 时间胶囊文件" };
    }
    if (meta.v !== VERSION) {
      return { ok: false, error: "胶囊版本不受支持：" + String(meta.v) };
    }
    if (!meta.id || typeof meta.id !== "string") {
      return { ok: false, error: "胶囊缺少 id" };
    }
    if (!meta.problem || typeof meta.problem !== "object") {
      return { ok: false, error: "胶囊缺少题目信息" };
    }
    if (typeof meta.file !== "string" || !meta.file) {
      return { ok: false, error: "胶囊缺少文件名" };
    }
    return { ok: true };
  }

  /** 解析 NDJSON 文本。损坏的尾部行（录制中断）会被忽略。 */
  function parseCapsule(text) {
    var source = typeof text === "string" ? text : "";
    var lines = source.split("\n");
    var meta = null;
    var events = [];
    var parseError = "";
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (!line) {
        continue;
      }
      var value;
      try {
        value = JSON.parse(line);
      } catch (error) {
        parseError = error && error.message ? error.message : String(error);
        // 只有最后一行允许损坏（崩溃时可能写了一半）。
        var hasLaterContent = false;
        for (var j = i + 1; j < lines.length; j += 1) {
          if (lines[j].trim()) {
            hasLaterContent = true;
            break;
          }
        }
        if (hasLaterContent) {
          return { ok: false, error: "胶囊内容损坏：" + parseError };
        }
        break;
      }
      if (meta === null) {
        meta = value;
      } else {
        events.push(value);
      }
    }
    var validation = validateCapsule(meta);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    return { ok: true, meta: meta, events: events, error: "" };
  }

  return {
    FORMAT: FORMAT,
    VERSION: VERSION,
    DEFAULT_IDLE_THRESHOLD_MS: DEFAULT_IDLE_THRESHOLD_MS,
    DEFAULT_IDLE_COMPRESSED_MS: DEFAULT_IDLE_COMPRESSED_MS,
    applyChanges: applyChanges,
    applyEvent: applyEvent,
    applyEventsTo: applyEventsTo,
    findCheckpoint: findCheckpoint,
    sliceAt: sliceAt,
    remapIdle: remapIdle,
    validateCapsule: validateCapsule,
    parseCapsule: parseCapsule
  };
});
