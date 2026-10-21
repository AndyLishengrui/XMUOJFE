/**
 * 时间胶囊回放页面。
 * 页面只渲染扩展下发的切片事件；不访问网络、磁盘或全局状态。
 */
(function () {
  "use strict";

  var vscode = acquireVsCodeApi();
  var capsule = window.XmuojCapsule;

  var el = function (id) {
    return document.getElementById(id);
  };

  var CARET_HTML = '<span class="caret"></span>';
  var WINDOW_LINES = 40;
  var IDLE_THRESHOLD_MS = 3000;
  var REQUEST_TIMEOUT_MS = 10000;

  var meta = null;
  var timeline = null;
  var duration = 1;
  var checkpoints = [];
  var markers = [];
  var eventCount = 0;
  var attempts = [];
  var currentId = "";
  var currentSummary = null;

  var playing = false;
  var ready = false;
  var speed = 1;
  var skipIdle = true;
  var playhead = 0;
  var dragging = false;

  var rafId = 0;
  var lastFrame = 0;
  var seekToken = 0;
  var segmentToken = 0;
  var requestCounter = 0;
  var pending = new Map();
  var segmentCache = new Map();
  var activeSegment = null;

  var text = "";
  var cursor = { a: 0, b: 0 };
  var applied = 0;
  var stateTime = 0;
  var patchWarned = false;

  var markerEls = [];
  var densityEls = [];
  var activeMarkerIndex = -1;

  var VIDEO_MAX_DURATION_MS = 30 * 60 * 1000;
  var VIDEO_WARN_DURATION_MS = 10 * 60 * 1000;
  var VIDEO_MAX_EVENTS = 200000;
  var VIDEO_BASE_WIDTH = 1280;
  var VIDEO_BASE_HEIGHT = 720;
  var videoConfig = { fps: 30, width: VIDEO_BASE_WIDTH, height: VIDEO_BASE_HEIGHT };
  var video = {
    busy: false,
    cancelled: false,
    success: false,
    recorder: null,
    stream: null,
    track: null,
    chunkQueue: Promise.resolve(),
    readyResolve: null,
    readyReject: null,
    finalizing: false,
    lastPath: "",
    timer: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var pad = function (value) {
      return String(value).padStart(2, "0");
    };
    return hours > 0 ? hours + ":" + pad(minutes) + ":" + pad(seconds) : pad(minutes) + ":" + pad(seconds);
  }

  function formatDate(value) {
    try {
      var date = new Date(value);
      if (isNaN(date.getTime())) {
        return "";
      }
      var pad = function (number) {
        return String(number).padStart(2, "0");
      };
      return (
        date.getFullYear() +
        "-" +
        pad(date.getMonth() + 1) +
        "-" +
        pad(date.getDate()) +
        " " +
        pad(date.getHours()) +
        ":" +
        pad(date.getMinutes())
      );
    } catch (_error) {
      return "";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showError(message) {
    var banner = el("error-banner");
    banner.textContent = message || "回放失败";
    banner.hidden = false;
  }

  function setButtonsEnabled(enabled) {
    var ids = ["btn-play", "btn-prev-edit", "btn-next-edit", "btn-prev-mark", "btn-next-mark", "seek"];
    for (var i = 0; i < ids.length; i += 1) {
      var node = el(ids[i]);
      if (node) {
        node.disabled = !enabled;
      }
    }
  }

  /* ------------------------------------------------------------ messaging */

  window.addEventListener("message", function (event) {
    var message = event.data || {};
    if (message.type === "capsule:init") {
      initialize(message);
      return;
    }
    if (message.type === "capsule:events") {
      var waiter = pending.get(message.requestId);
      if (waiter) {
        pending.delete(message.requestId);
        waiter.resolve(Array.isArray(message.events) ? message.events : []);
      }
      return;
    }
    if (message.type === "capsule:error") {
      showError(message.message);
      return;
    }
    if (message.type === "capsule:videoReady") {
      if (video.readyResolve) {
        var resolve = video.readyResolve;
        video.readyResolve = null;
        video.readyReject = null;
        resolve(message.path);
      }
      return;
    }
    if (message.type === "capsule:videoError") {
      if (video.readyReject) {
        var reject = video.readyReject;
        video.readyResolve = null;
        video.readyReject = null;
        reject(new Error(message.message || "无法开始导出"));
      } else {
        video.busy = false;
        setVideoStatus(message.message || "导出失败");
        setVideoButtons(false);
      }
      return;
    }
    if (message.type === "capsule:videoFinished") {
      video.lastPath = message.path || "";
      video.finalizing = false;
      setVideoStatus("导出完成：" + (message.path || ""));
      el("video-start").textContent = "关闭";
      setVideoButtons(false);
      return;
    }
    if (message.type === "capsule:videoCancelled") {
      video.finalizing = false;
      setVideoStatus(message.message || "已取消导出");
      setVideoButtons(false);
      el("video-start").textContent = "关闭";
    }
  });

  function requestEvents(start, count) {
    var requestId = "r" + ++requestCounter;
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          resolve([]);
          showError("读取回放数据超时，请关闭面板后重新打开。");
        }
      }, REQUEST_TIMEOUT_MS);
      pending.set(requestId, {
        resolve: function (events) {
          clearTimeout(timer);
          resolve(events);
        }
      });
      vscode.postMessage({ type: "events", requestId: requestId, start: start, count: count });
    });
  }

  /* ------------------------------------------------------------- lifecycle */

  function initialize(message) {
    resetPlayback();
    meta = message.meta || {};
    currentId = String(message.currentId || meta.id || "");
    attempts = Array.isArray(message.attempts) ? message.attempts : [];
    timeline = message.timeline || {};
    checkpoints = Array.isArray(timeline.checkpoints) ? timeline.checkpoints : [];
    markers = Array.isArray(timeline.markers) ? timeline.markers : [];
    eventCount = Math.max(0, Number(timeline.eventCount) || 0);
    duration = Math.max(1, Number(timeline.durationMs) || 0);
    if (message.video && typeof message.video === "object") {
      videoConfig = {
        fps: clamp(Number(message.video.fps) || 30, 10, 60),
        width: clamp(Number(message.video.width) || VIDEO_BASE_WIDTH, 640, 3840),
        height: clamp(Number(message.video.height) || VIDEO_BASE_HEIGHT, 360, 2160)
      };
    }

    renderHeader();
    // 摘要数据始终保留，关闭横幅后仍可从顶部「录制摘要」重新打开。
    currentSummary = message.summary || message.preview || null;
    renderSummary(message.preview || null);
    if (message.preview) {
      // 通知扩展侧摘要已经真正显示，后台面板不会提前丢掉它。
      vscode.postMessage({ type: "summaryShown", id: currentId });
    }
    renderAttempts();
    buildDensity(Array.isArray(timeline.density) ? timeline.density : []);
    buildMarkers();

    var seek = el("seek");
    seek.min = "0";
    seek.max = String(duration);
    seek.step = "1";
    seek.value = "0";

    ready = true;
    setButtonsEnabled(true);
    el("code-empty").hidden = true;

    seekTo(0);
  }

  /** 切换尝试时清空播放器与缓存，避免把上一条胶囊的事件续到新文本上。 */
  function resetPlayback() {
    pause();
    ready = false;
    playhead = 0;
    activeSegment = null;
    segmentCache.clear();
    seekToken += 1;
    segmentToken += 1;
    text = "";
    cursor = { a: 0, b: 0 };
    applied = 0;
    stateTime = 0;
    patchWarned = false;
    markerEls = [];
    densityEls = [];
    activeMarkerIndex = -1;
  }

  function resultInfo(attempt) {
    var raw = String((attempt && attempt.result) || "").trim();
    if (!raw) {
      return { label: "", className: "" };
    }
    var accepted = /^(accepted|ac|0)$/i.test(raw);
    return {
      label: accepted ? "AC" : raw.toUpperCase().slice(0, 10),
      className: accepted ? "accepted" : "failed"
    };
  }

  /** 停止录制后展示一次可见的结果摘要，而不是只发一条短暂通知。 */
  function renderSummary(preview) {
    var host = el("recording-summary");
    if (!host) {
      return;
    }
    if (!preview) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    var title = el("summary-title");
    var attemptNumber = Number(preview.attempt);
    title.textContent =
      Number.isFinite(attemptNumber) && attemptNumber > 0
        ? "第 " + attemptNumber + " 次录制已保存"
        : preview.title || "本次录制已保存";

    var resultBadge = el("summary-result");
    var result = resultInfo(preview);
    if (result.label) {
      resultBadge.hidden = false;
      resultBadge.textContent = result.label;
      resultBadge.className = "capsule-badge " + result.className;
    } else {
      resultBadge.hidden = true;
      resultBadge.textContent = "";
    }

    var metaParts = [];
    if (preview.file) {
      metaParts.push(preview.file);
    }
    if (preview.language) {
      metaParts.push(preview.language);
    }
    if (preview.startedAt) {
      var dateText = formatDate(preview.startedAt);
      if (dateText) {
        metaParts.push("录制于 " + dateText);
      }
    }
    el("summary-meta").textContent = metaParts.join(" · ");

    var stats = el("summary-stats");
    stats.textContent = "";
    var addStat = function (label, value) {
      var span = document.createElement("span");
      span.className = "summary-stat";
      var strong = document.createElement("b");
      strong.textContent = String(value);
      span.appendChild(document.createTextNode(label + " "));
      span.appendChild(strong);
      stats.appendChild(span);
    };
    addStat("时长", formatDuration(preview.durationMs));
    addStat("编辑", Number(preview.edits) || 0);
    addStat("运行", Number(preview.runs) || 0);
    addStat("提交", Number(preview.submits) || 0);
    if (Number(preview.eventCount) > 0) {
      addStat("事件", Number(preview.eventCount));
    }

    el("summary-compare").hidden = attempts.length < 2;
  }

  function renderAttempts() {
    var host = el("attempts");
    if (!host) {
      return;
    }
    host.textContent = "";
    if (attempts.length < 2) {
      host.hidden = true;
      el("btn-compare").hidden = true;
      return;
    }
    host.hidden = false;
    el("btn-compare").hidden = false;

    for (var i = 0; i < attempts.length; i += 1) {
      var attempt = attempts[i] || {};
      var card = document.createElement("button");
      card.type = "button";
      card.className = "attempt-card" + (String(attempt.id) === currentId ? " active" : "");
      card.setAttribute("aria-pressed", String(attempt.id) === currentId ? "true" : "false");
      if (String(attempt.id) === currentId) {
        card.setAttribute("aria-current", "true");
      }

      var top = document.createElement("span");
      top.className = "attempt-top";
      var number = Number(attempt.attemptNumber);
      var label = document.createElement("span");
      label.textContent = "第 " + (Number.isFinite(number) && number > 0 ? number : i + 1) + " 次";
      top.appendChild(label);
      var result = resultInfo(attempt);
      if (result.label) {
        var badge = document.createElement("span");
        badge.className = "attempt-result " + result.className;
        badge.textContent = result.label;
        top.appendChild(badge);
      }
      card.appendChild(top);

      var metaLine = document.createElement("span");
      metaLine.className = "attempt-meta";
      var bits = [];
      if (attempt.startedAt) {
        bits.push(formatDate(attempt.startedAt));
      }
      bits.push(formatDuration(attempt.durationMs));
      if (attempt.language) {
        bits.push(attempt.language);
      }
      metaLine.textContent = bits.filter(Boolean).join(" · ");
      card.appendChild(metaLine);

      var stats = attempt.stats || {};
      var statsLine = document.createElement("span");
      statsLine.className = "attempt-stats";
      statsLine.textContent =
        "编辑 " +
        (Number(stats.edits) || 0) +
        " · 运行 " +
        (Number(stats.runs) || 0) +
        " · 提交 " +
        (Number(stats.submits) || 0);
      card.appendChild(statsLine);

      (function (id) {
        card.addEventListener("click", function () {
          if (!id || id === currentId || video.busy) {
            return;
          }
          vscode.postMessage({ type: "selectAttempt", id: id });
        });
      })(String(attempt.id || ""));
      host.appendChild(card);
    }
  }

  function renderHeader() {
    var problem = meta.problem || {};
    var title = [problem.displayId || problem.id || "", problem.title || ""].filter(Boolean).join(" ");
    el("capsule-problem").textContent = title || meta.file || "时间胶囊";

    var parts = [];
    if (meta.language) {
      parts.push(meta.language);
    }
    if (meta.file) {
      parts.push(meta.file);
    }
    if (meta.startedAt) {
      var dateText = formatDate(meta.startedAt);
      if (dateText) {
        parts.push("录制于 " + dateText);
      }
    }
    parts.push("时长 " + formatDuration(duration));
    if (typeof meta.eventCount === "number") {
      parts.push(meta.eventCount + " 个事件");
    }
    el("capsule-meta").textContent = parts.join(" · ");
    document.title = "回放 · " + (title || meta.file || "");

    var badge = el("capsule-result");
    var result = String(meta.result || "").trim();
    if (!result) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      var normalized = result.toLowerCase();
      var accepted = normalized === "accepted" || normalized === "ac" || normalized === "0";
      badge.textContent = accepted ? "AC" : result.toUpperCase();
      badge.className = "capsule-badge " + (accepted ? "accepted" : "failed");
    }
  }

  function buildDensity(buckets) {
    var host = el("density");
    host.textContent = "";
    densityEls = [];
    var max = 1;
    for (var i = 0; i < buckets.length; i += 1) {
      max = Math.max(max, Number(buckets[i]) || 0);
    }
    for (var j = 0; j < buckets.length; j += 1) {
      var bar = document.createElement("span");
      var weight = Math.max(0, Number(buckets[j]) || 0);
      bar.style.height = (weight > 0 ? Math.max(8, (weight / max) * 100) : 2) + "%";
      bar.style.opacity = weight > 0 ? "0.55" : "0.12";
      host.appendChild(bar);
      densityEls.push(bar);
    }
  }

  function markerClass(marker) {
    var name = String(marker.name || "");
    if (name === "result") {
      var label = String(marker.label || "").toLowerCase();
      if (label.indexOf("accept") >= 0 || label === "ac") {
        return "accepted";
      }
      if (label) {
        return "failed";
      }
      return "muted";
    }
    if (name === "submit") {
      return "submit";
    }
    if (name === "run" || name === "run-result") {
      return "run";
    }
    return "muted";
  }

  function buildMarkers() {
    var host = el("markers");
    host.textContent = "";
    markerEls = [];
    for (var i = 0; i < markers.length; i += 1) {
      var marker = markers[i];
      if (!marker || typeof marker.t !== "number") {
        continue;
      }
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "timeline-marker " + markerClass(marker);
      dot.style.left = clamp((marker.t / duration) * 100, 0, 100) + "%";
      dot.title = formatDuration(marker.t) + " · " + (marker.label || marker.name || "标记");
      dot.setAttribute("aria-label", dot.title);
      (function (time) {
        dot.addEventListener("click", function (event) {
          event.stopPropagation();
          pause();
          seekTo(time);
        });
      })(marker.t);
      host.appendChild(dot);
      markerEls.push({ marker: marker, node: dot });
    }
  }

  /* -------------------------------------------------------------- segments */

  function checkpointIndexFor(time) {
    if (!checkpoints.length) {
      return -1;
    }
    var low = 0;
    var high = checkpoints.length - 1;
    var found = 0;
    while (low <= high) {
      var mid = (low + high) >> 1;
      if (Number(checkpoints[mid].t) <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  function loadSegment(time) {
    var index = checkpointIndexFor(time);
    if (index < 0) {
      return Promise.resolve(null);
    }
    var cached = segmentCache.get(index);
    if (cached) {
      return Promise.resolve(cached);
    }
    var checkpoint = checkpoints[index];
    var start = Math.max(0, Number(checkpoint.index) || 0);
    var next = checkpoints[index + 1];
    var end = next ? Math.max(start, Number(next.index) || start) : eventCount;
    var token = ++segmentToken;
    return requestEvents(start, Math.max(0, end - start)).then(function (events) {
      if (!events.length) {
        return null;
      }
      var segment = { cpIndex: index, startIndex: start, events: events };
      if (token === segmentToken) {
        segmentCache.set(index, segment);
        if (segmentCache.size > 4) {
          var oldest = segmentCache.keys().next();
          if (!oldest.done) {
            segmentCache.delete(oldest.value);
          }
        }
      }
      return segment;
    });
  }

  function resetSegment(segment, target) {
    var state = { text: "", cursor: { a: 0, b: 0 }, time: 0 };
    var count = 0;
    for (var i = 0; i < segment.events.length; i += 1) {
      var event = segment.events[i];
      if (!event) {
        continue;
      }
      if (typeof event.t === "number" && event.t > target) {
        break;
      }
      var result = capsule.applyEvent(state, event);
      if (!result.ok) {
        warnPatch(result.error);
        break;
      }
      state = { text: result.text, cursor: result.cursor, time: result.time };
      count = i + 1;
    }
    text = state.text;
    cursor = state.cursor;
    applied = count;
    stateTime = typeof state.time === "number" ? state.time : 0;
  }

  function advanceTo(segment, target) {
    var state = { text: text, cursor: cursor, time: stateTime };
    var count = applied;
    for (var i = applied; i < segment.events.length; i += 1) {
      var event = segment.events[i];
      if (!event || (typeof event.t === "number" && event.t > target)) {
        break;
      }
      var result = capsule.applyEvent(state, event);
      if (!result.ok) {
        warnPatch(result.error);
        resetSegment(segment, target);
        return;
      }
      state = { text: result.text, cursor: result.cursor, time: result.time };
      count = i + 1;
    }
    text = state.text;
    cursor = state.cursor;
    applied = count;
    stateTime = typeof state.time === "number" ? state.time : 0;
  }

  function warnPatch(message) {
    if (patchWarned) {
      return;
    }
    patchWarned = true;
    showError("回放数据有一处不连续（" + message + "），已尽量跳过损坏片段。");
  }

  function seekTo(time) {
    if (!ready) {
      return Promise.resolve();
    }
    var target = clamp(Number(time) || 0, 0, duration);
    playhead = target;
    updateTimeUi();
    var token = ++seekToken;
    return loadSegment(target).then(function (segment) {
      if (token !== seekToken) {
        return;
      }
      if (!segment) {
        showError("胶囊中没有可回放的事件。");
        return;
      }
      if (segment !== activeSegment) {
        activeSegment = segment;
        resetSegment(segment, target);
      } else if (target < stateTime) {
        resetSegment(segment, target);
      } else {
        advanceTo(segment, target);
      }
      renderCode();
      renderMark();
    });
  }

  /* ------------------------------------------------------------- rendering */

  function offsetAtLineStart(lineStarts, line) {
    return lineStarts[clamp(line, 0, lineStarts.length - 1)];
  }

  function lineStartsOf(source) {
    var starts = [0];
    for (var i = 0; i < source.length; i += 1) {
      if (source.charAt(i) === "\n") {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  function lineOfOffset(starts, offset) {
    var low = 0;
    var high = starts.length - 1;
    var found = 0;
    while (low <= high) {
      var mid = (low + high) >> 1;
      if (starts[mid] <= offset) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  function renderLine(lineText, caretColumn, selStart, selEnd) {
    if (!lineText.length && caretColumn === null) {
      return "​";
    }
    var length = lineText.length;
    var parts = [];
    var hasSelection = selStart !== null && selEnd !== null && selEnd > selStart;
    if (hasSelection) {
      var from = clamp(selStart, 0, length);
      var to = clamp(selEnd, 0, length);
      parts = [
        [0, from, false],
        [from, to, true],
        [to, length, false]
      ];
    } else {
      parts = [[0, length, false]];
    }
    var html = "";
    var inserted = false;
    for (var i = 0; i < parts.length; i += 1) {
      var start = parts[i][0];
      var end = parts[i][1];
      var highlighted = parts[i][2];
      var piece = lineText.slice(start, end);
      if (!inserted && caretColumn !== null && caretColumn >= start && caretColumn <= end) {
        var local = clamp(caretColumn - start, 0, piece.length);
        var before = escapeHtml(piece.slice(0, local));
        var after = escapeHtml(piece.slice(local));
        if (highlighted) {
          html += '<span class="hl">' + before + CARET_HTML + after + "</span>";
        } else {
          html += before + CARET_HTML + after;
        }
        inserted = true;
      } else if (highlighted) {
        html += '<span class="hl">' + escapeHtml(piece) + "</span>";
      } else {
        html += escapeHtml(piece);
      }
    }
    if (!inserted && caretColumn !== null) {
      html += CARET_HTML;
    }
    return html || "​";
  }

  function renderCode() {
    var host = el("code-view");
    var lines = text.split("\n");
    var starts = lineStartsOf(text);
    var caretOffset = clamp(cursor.b, 0, text.length);
    var caretLine = lineOfOffset(starts, caretOffset);
    var caretColumn = caretOffset - starts[caretLine];
    var selA = clamp(Math.min(cursor.a, cursor.b), 0, text.length);
    var selB = clamp(Math.max(cursor.a, cursor.b), 0, text.length);
    var hasSelection = selB > selA;

    var start = Math.max(0, Math.min(caretLine - Math.floor(WINDOW_LINES / 2), lines.length - WINDOW_LINES));
    if (lines.length <= WINDOW_LINES) {
      start = 0;
    }
    var end = Math.min(lines.length, start + WINDOW_LINES);

    var html = [];
    for (var line = start; line < end; line += 1) {
      var lineStart = starts[line];
      var lineText = lines[line];
      var lineEnd = lineStart + lineText.length;
      var caretAt = line === caretLine ? clamp(caretColumn, 0, lineText.length) : null;
      var markStart = null;
      var markEnd = null;
      if (hasSelection && selA <= lineEnd && selB >= lineStart) {
        markStart = Math.max(0, selA - lineStart);
        markEnd = Math.min(lineText.length, selB - lineStart);
        if (markEnd <= markStart) {
          markStart = null;
          markEnd = null;
        }
      }
      html.push(
        '<div class="code-line' +
          (line === caretLine ? " active" : "") +
          '"><span class="line-no">' +
          (line + 1) +
          '</span><span class="line-text">' +
          renderLine(lineText, caretAt, markStart, markEnd) +
          "</span></div>"
      );
    }
    if (start > 0 || end < lines.length) {
      html.push(
        '<div class="code-note">仅显示光标附近 · 第 ' +
          (start + 1) +
          "–" +
          end +
          " 行 / 共 " +
          lines.length +
          " 行</div>"
      );
    }
    host.innerHTML = html.join("");
    el("position-label").textContent = "第 " + (caretLine + 1) + " / " + lines.length + " 行";
  }

  function renderMark() {
    var found = -1;
    for (var i = 0; i < markers.length; i += 1) {
      if (typeof markers[i].t === "number" && markers[i].t <= playhead + 1) {
        found = i;
      } else if (typeof markers[i].t === "number") {
        break;
      }
    }
    activeMarkerIndex = found;
    for (var j = 0; j < markerEls.length; j += 1) {
      markerEls[j].node.classList.toggle("active", j === found);
    }
    var label = el("current-mark");
    if (found < 0) {
      label.textContent = "尚未产生运行或提交记录";
      return;
    }
    var marker = markers[found];
    var detail = "";
    if (marker.detail && typeof marker.detail === "object") {
      if (typeof marker.detail.passed === "number" && typeof marker.detail.total === "number") {
        detail = " · 通过 " + marker.detail.passed + "/" + marker.detail.total;
      } else if (marker.detail.submissionId) {
        detail = " · 提交 " + String(marker.detail.submissionId).slice(0, 12);
      }
    }
    label.textContent = "";
    var time = document.createElement("span");
    time.textContent = formatDuration(marker.t) + " ";
    var strong = document.createElement("span");
    strong.className = "mark-label";
    strong.textContent = marker.label || marker.name || "标记";
    var rest = document.createElement("span");
    rest.textContent = detail;
    label.appendChild(time);
    label.appendChild(strong);
    label.appendChild(rest);
  }

  function updateTimeUi() {
    var seek = el("seek");
    if (!dragging) {
      seek.value = String(Math.round(playhead));
    }
    el("time-label").textContent = formatDuration(playhead) + " / " + formatDuration(duration);
  }

  /* -------------------------------------------------------------- playback */

  function nextIdleJump() {
    if (!activeSegment) {
      return null;
    }
    var events = activeSegment.events;
    for (var i = 0; i < events.length; i += 1) {
      var event = events[i];
      if (event && typeof event.t === "number" && event.t > playhead + 1) {
        return event.t - playhead > IDLE_THRESHOLD_MS ? event.t : null;
      }
    }
    var index = checkpointIndexFor(playhead);
    if (index >= 0 && checkpoints[index + 1]) {
      var nextTime = Number(checkpoints[index + 1].t) || 0;
      if (nextTime - playhead > IDLE_THRESHOLD_MS) {
        return nextTime;
      }
    }
    return null;
  }

  function tick(now) {
    if (!playing) {
      return;
    }
    var delta = Math.min(250, Math.max(0, now - lastFrame));
    lastFrame = now;
    var target = playhead + delta * speed;
    if (skipIdle) {
      var jump = nextIdleJump();
      if (jump !== null && jump > target) {
        target = jump;
      }
    }
    if (target >= duration) {
      target = duration;
    }
    seekTo(target).then(function () {
      if (playing && playhead >= duration - 1) {
        pause();
      }
    });
    if (playing) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function play() {
    if (!ready || playing) {
      return;
    }
    if (playhead >= duration) {
      seekTo(0).then(function () {
        if (ready) {
          startClock();
        }
      });
      return;
    }
    startClock();
  }

  function startClock() {
    playing = true;
    el("btn-play").textContent = "暂停";
    lastFrame = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    el("btn-play").textContent = "播放";
  }

  function togglePlay() {
    if (playing) {
      pause();
    } else {
      play();
    }
  }

  /* ----------------------------------------------------------- navigation */

  function findTime(kind, direction) {
    if (kind === "marker") {
      var best = null;
      for (var i = 0; i < markers.length; i += 1) {
        var markerTime = Number(markers[i].t) || 0;
        if (direction > 0 && markerTime > playhead + 1) {
          best = best === null ? markerTime : Math.min(best, markerTime);
        } else if (direction < 0 && markerTime < playhead - 1) {
          best = best === null ? markerTime : Math.max(best, markerTime);
        }
      }
      return Promise.resolve(best);
    }
    return findEventTime(direction);
  }

  function findEventTime(direction) {
    var steps = 0;
    function step(segment) {
      if (!segment || steps > 40) {
        return Promise.resolve(null);
      }
      var events = segment.events;
      if (direction > 0) {
        for (var i = 0; i < events.length; i += 1) {
          var event = events[i];
          if (event && event.k === "e" && typeof event.t === "number" && event.t > playhead + 1) {
            return Promise.resolve(event.t);
          }
        }
        var nextIndex = checkpointIndexFor(playhead) + 1;
        if (nextIndex >= checkpoints.length) {
          return Promise.resolve(null);
        }
        steps += 1;
        return loadSegment(Number(checkpoints[nextIndex].t) || 0).then(step);
      }
      for (var j = events.length - 1; j >= 0; j -= 1) {
        var back = events[j];
        if (back && back.k === "e" && typeof back.t === "number" && back.t < playhead - 1) {
          return Promise.resolve(back.t);
        }
      }
      var current = checkpointIndexFor(playhead);
      if (current <= 0) {
        return Promise.resolve(null);
      }
      steps += 1;
      return loadSegment(Number(checkpoints[current - 1].t) || 0).then(step);
    }
    if (activeSegment) {
      return step(activeSegment);
    }
    return loadSegment(playhead).then(step);
  }

  function jump(kind, direction) {
    pause();
    findTime(kind, direction).then(function (time) {
      if (time === null || time === undefined) {
        return;
      }
      seekTo(time);
    });
  }

  /* ---------------------------------------------------------- video export */

  function setVideoStatus(message) {
    el("video-status").textContent = message || "";
  }

  function setVideoButtons(busy) {
    el("video-start").disabled = Boolean(busy);
    el("video-cancel").textContent = busy ? "取消导出" : "关闭";
  }

  function openVideoDialog() {
    if (!ready) {
      return;
    }
    if (duration > VIDEO_MAX_DURATION_MS) {
      showError("视频导出仅支持 30 分钟以内的胶囊。可以改用回放或导出胶囊文件。");
      return;
    }
    if (eventCount > VIDEO_MAX_EVENTS) {
      showError("胶囊事件超过 20 万个，导出视频可能导致页面内存不足。请改用回放。");
      return;
    }
    pause();
    video.lastPath = "";
    el("video-overlay").hidden = false;
    el("video-start").textContent = "开始导出";
    el("video-start").disabled = false;
    el("video-cancel").textContent = "关闭";
    el("video-bar").style.width = "0%";
    el(
      "video-hint"
    ).textContent =
      duration > VIDEO_WARN_DURATION_MS
        ? "该胶囊超过 10 分钟。1× 导出需要相同时长，建议选择 2× 或 4×；视频为 WebM，不生成 MP4。"
        : "使用画布逐帧重放，不依赖 ffmpeg。视频按所选速度录制，速度越高导出越短；视频为 WebM，不生成 MP4。";
    setVideoStatus("准备导出…");
  }

  function closeVideoDialog() {
    if (video.busy) {
      return;
    }
    el("video-overlay").hidden = true;
  }

  function pickVideoMime() {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
      return "";
    }
    var candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (var i = 0; i < candidates.length; i += 1) {
      if (MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return "";
  }

  function requestVideoStart() {
    return new Promise(function (resolve, reject) {
      video.readyResolve = resolve;
      video.readyReject = reject;
      vscode.postMessage({ type: "videoStart" });
    });
  }

  function loadAllEvents() {
    var all = [];
    var start = 0;
    function next() {
      if (start >= eventCount) {
        return Promise.resolve(all);
      }
      if (video.cancelled) {
        return Promise.resolve(all);
      }
      var count = Math.min(5000, eventCount - start);
      setVideoStatus("正在读取事件 " + Math.round((start / Math.max(1, eventCount)) * 100) + "%…");
      return requestEvents(start, count).then(function (chunk) {
        if (!chunk.length) {
          return all;
        }
        for (var i = 0; i < chunk.length; i += 1) {
          all.push(chunk[i]);
        }
        start += chunk.length;
        return next();
      });
    }
    return next();
  }

  function queueVideoChunk(blob) {
    video.chunkQueue = video.chunkQueue
      .then(function () {
        return blob.arrayBuffer();
      })
      .then(function (buffer) {
        vscode.postMessage({ type: "videoChunk", data: new Uint8Array(buffer) });
      })
      .catch(function () {
        return null;
      });
  }

  function readVideoTheme() {
    var root = getComputedStyle(document.documentElement);
    var body = getComputedStyle(document.body);
    var read = function (name, fallback) {
      var value = (root.getPropertyValue(name) || "").trim();
      return value || fallback;
    };
    return {
      bg: body.backgroundColor || "#1e1e1e",
      fg: body.color || "#dddddd",
      desc: read("--vscode-descriptionForeground", "#9a9a9a"),
      accent: read("--vscode-focusBorder", "#3794ff"),
      line: read("--vscode-editor-lineHighlightBackground", "rgba(128,128,128,0.18)"),
      pass: "#3fb950",
      fail: "#f85149"
    };
  }

  function drawVideoFrame(ctx, state, time, theme, markerIndex) {
    var W = VIDEO_BASE_WIDTH;
    var H = VIDEO_BASE_HEIGHT;
    var PAD = 40;
    var font = '15px "SFMono-Regular", Consolas, "Liberation Mono", monospace';
    ctx.save();
    ctx.scale(videoConfig.width / W, videoConfig.height / H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = theme.fg;
    ctx.font = '600 26px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(el("capsule-problem").textContent.slice(0, 60), PAD, 52);

    ctx.fillStyle = theme.desc;
    ctx.font = '15px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(el("capsule-meta").textContent.slice(0, 120), PAD, 80);

    var result = String((meta && meta.result) || "").trim();
    if (result) {
      var accepted = /^(accepted|ac|0)$/i.test(result);
      var label = accepted ? "AC" : result.toUpperCase().slice(0, 14);
      ctx.font = '700 15px -apple-system, "Segoe UI", sans-serif';
      var textWidth = ctx.measureText(label).width;
      var badgeWidth = textWidth + 26;
      ctx.fillStyle = accepted ? theme.pass : theme.fail;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(W - PAD - badgeWidth, 30, badgeWidth, 28, 14);
        ctx.fill();
      } else {
        ctx.fillRect(W - PAD - badgeWidth, 30, badgeWidth, 28);
      }
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(label, W - PAD - badgeWidth / 2, 49);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = theme.line;
    ctx.fillRect(PAD, 98, W - PAD * 2, 1);

    var lines = state.text.split("\n");
    var starts = lineStartsOf(state.text);
    var caretOffset = clamp(state.cursor.b, 0, state.text.length);
    var caretLine = lineOfOffset(starts, caretOffset);
    var caretColumn = caretOffset - starts[caretLine];
    var lineHeight = 22;
    var codeTop = 126;
    var codeBottom = H - 92;
    var maxLines = Math.max(1, Math.floor((codeBottom - codeTop) / lineHeight));
    var start = Math.max(0, Math.min(caretLine - Math.floor(maxLines / 2), lines.length - maxLines));
    if (lines.length <= maxLines) {
      start = 0;
    }
    var end = Math.min(lines.length, start + maxLines);
    var gutter = 54;

    for (var i = start; i < end; i += 1) {
      var baseline = codeTop + (i - start + 1) * lineHeight - 5;
      if (i === caretLine) {
        ctx.fillStyle = theme.line;
        ctx.fillRect(0, baseline - lineHeight + 5, W, lineHeight);
      }
      ctx.font = "13px " + font.slice(font.indexOf(" ") + 1);
      ctx.fillStyle = theme.desc;
      ctx.textAlign = "right";
      ctx.fillText(String(i + 1), PAD + gutter, baseline);
      ctx.textAlign = "left";
      ctx.font = font;
      var display = lines[i].replace(/\t/g, "    ").slice(0, 160);
      ctx.fillStyle = theme.fg;
      ctx.fillText(display, PAD + gutter + 18, baseline);
      if (i === caretLine) {
        var prefix = display.slice(0, clamp(caretColumn, 0, display.length));
        var caretX = PAD + gutter + 18 + ctx.measureText(prefix).width;
        ctx.fillStyle = theme.accent;
        ctx.fillRect(caretX, baseline - lineHeight + 8, 2, lineHeight - 4);
      }
    }

    if (start > 0 || end < lines.length) {
      ctx.font = '12px -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = theme.desc;
      ctx.textAlign = "right";
      ctx.fillText("第 " + (start + 1) + "–" + end + " 行 / 共 " + lines.length + " 行", W - PAD, H - 70);
      ctx.textAlign = "left";
    }

    var barY = H - 58;
    var barWidth = W - PAD * 2;
    ctx.fillStyle = "rgba(128,128,128,0.28)";
    ctx.fillRect(PAD, barY, barWidth, 6);
    ctx.fillStyle = theme.accent;
    ctx.fillRect(PAD, barY, barWidth * clamp(time / duration, 0, 1), 6);

    ctx.font = '15px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = theme.fg;
    ctx.fillText(formatDuration(time) + " / " + formatDuration(duration), PAD, H - 26);

    var marker = markerIndex >= 0 ? markers[markerIndex] : null;
    if (marker) {
      var markerLabel = (marker.label || marker.name || "").slice(0, 60);
      ctx.textAlign = "right";
      ctx.fillStyle = markerClass(marker) === "accepted" ? theme.pass : theme.desc;
      ctx.fillText(formatDuration(marker.t) + " · " + markerLabel, W - PAD, H - 26);
      ctx.textAlign = "left";
    }
    ctx.restore();
  }

  function resetVideoState() {
    video.busy = false;
    video.cancelled = false;
    video.finalizing = false;
    video.finalized = false;
    video.recorder = null;
    video.stream = null;
    video.track = null;
    video.chunkQueue = Promise.resolve();
    if (video.timer) {
      clearTimeout(video.timer);
      video.timer = 0;
    }
  }

  function stopVideoExport(success) {
    if (!video.busy && !video.finalizing) {
      return;
    }
    video.busy = false;
    video.success = Boolean(success);
    if (video.timer) {
      clearTimeout(video.timer);
      video.timer = 0;
    }
    if (!video.finalizing) {
      video.finalizing = true;
      var recorder = video.recorder;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
          return;
        } catch (_error) {
          /* 落到下面的收尾 */
        }
      }
      finalizeVideoExport();
    }
  }

  function finalizeVideoExport() {
    if (video.finalized) {
      return;
    }
    video.finalized = true;
    var stream = video.stream;
    video.stream = null;
    video.track = null;
    video.recorder = null;
    if (stream) {
      try {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
      } catch (_error) {
        /* 忽略 */
      }
    }
    var success = video.success;
    setVideoStatus(success ? "正在写入文件…" : "正在取消…");
    video.chunkQueue
      .then(function () {
        vscode.postMessage({ type: success ? "videoDone" : "videoCancel" });
        if (!success) {
          video.finalizing = false;
          setVideoStatus("已取消导出");
          setVideoButtons(false);
          el("video-start").textContent = "关闭";
        }
      })
      .catch(function () {
        video.finalizing = false;
        setVideoStatus("导出失败：写入中断");
        setVideoButtons(false);
        el("video-start").textContent = "关闭";
      });
  }

  function beginVideoExport() {
    if (video.busy) {
      return;
    }
    if (duration > VIDEO_MAX_DURATION_MS || eventCount > VIDEO_MAX_EVENTS) {
      setVideoStatus("胶囊过大，无法导出视频");
      return;
    }
    var mime = pickVideoMime();
    if (!mime) {
      setVideoStatus("当前环境不支持 MediaRecorder，无法导出视频");
      return;
    }
    pause();
    resetVideoState();
    video.busy = true;
    video.cancelled = false;
    video.success = false;
    setVideoButtons(true);
    setVideoStatus("请选择保存位置…");
    var speed = Number(el("video-speed").value) || 2;

    requestVideoStart()
      .then(function (path) {
        if (video.cancelled) {
          vscode.postMessage({ type: "videoCancel" });
          resetVideoState();
          setVideoStatus("已取消导出");
          setVideoButtons(false);
          el("video-start").textContent = "关闭";
          return null;
        }
        video.lastPath = path || "";
        setVideoStatus("正在读取事件 0%…");
        return loadAllEvents();
      })
      .then(function (events) {
        if (!events) {
          return null;
        }
        if (video.cancelled) {
          vscode.postMessage({ type: "videoCancel" });
          resetVideoState();
          setVideoStatus("已取消导出");
          setVideoButtons(false);
          el("video-start").textContent = "关闭";
          return null;
        }
        var canvas = document.createElement("canvas");
        canvas.width = videoConfig.width;
        canvas.height = videoConfig.height;
        var ctx = canvas.getContext("2d");
        var theme = readVideoTheme();
        var stream = canvas.captureStream(0);
        var track = stream.getVideoTracks()[0];
        var canRequestFrame = track && typeof track.requestFrame === "function";
        if (!canRequestFrame) {
          stream = canvas.captureStream(30);
          track = stream.getVideoTracks()[0];
        }
        video.stream = stream;
        video.track = track;
        var recorder;
        try {
          recorder = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: 2500000
          });
        } catch (error) {
          vscode.postMessage({ type: "videoCancel" });
          resetVideoState();
          setVideoStatus("无法启动视频编码器：" + (error && error.message ? error.message : error));
          setVideoButtons(false);
          el("video-start").textContent = "关闭";
          return null;
        }
        video.recorder = recorder;
        video.finalized = false;
        video.finalizing = false;
        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size > 0) {
            queueVideoChunk(event.data);
          }
        };
        recorder.onerror = function () {
          setVideoStatus("视频编码失败");
          video.cancelled = true;
          stopVideoExport(false);
        };
        recorder.onstop = function () {
          finalizeVideoExport();
        };

        var eventIndex = 0;
        var markerIndex = -1;
        var state = { text: "", cursor: { a: 0, b: 0 }, time: 0 };
        var wallStart = performance.now();
        drawVideoFrame(ctx, state, 0, theme, -1);
        if (canRequestFrame) {
          track.requestFrame();
        }
        recorder.start(1000);
        setVideoStatus("导出中 0%");

        var step = function () {
          if (!video.busy || video.cancelled) {
            if (video.cancelled && video.busy) {
              stopVideoExport(false);
            }
            return;
          }
          var target = Math.min(duration, (performance.now() - wallStart) * speed);
          while (eventIndex < events.length) {
            var event = events[eventIndex];
            if (event && typeof event.t === "number" && event.t > target) {
              break;
            }
            var appliedState = capsule.applyEvent(state, event);
            if (appliedState.ok) {
              state = {
                text: appliedState.text,
                cursor: appliedState.cursor,
                time: appliedState.time
              };
            }
            eventIndex += 1;
          }
          while (
            markerIndex + 1 < markers.length &&
            Number(markers[markerIndex + 1].t) <= target
          ) {
            markerIndex += 1;
          }
          drawVideoFrame(ctx, state, target, theme, markerIndex);
          if (canRequestFrame) {
            track.requestFrame();
          }
          var ratio = Math.min(1, target / duration);
          el("video-bar").style.width = (ratio * 100).toFixed(1) + "%";
          setVideoStatus(
            "导出中 " +
              Math.round(ratio * 100) +
              "% · " +
              formatDuration(target) +
              " / " +
              formatDuration(duration)
          );
          if (target >= duration - 1) {
            stopVideoExport(true);
            return;
          }
          video.timer = setTimeout(step, 1000 / videoConfig.fps);
        };
        step();
        return null;
      })
      .catch(function (error) {
        vscode.postMessage({ type: "videoCancel" });
        resetVideoState();
        setVideoStatus("导出失败：" + (error && error.message ? error.message : String(error)));
        setVideoButtons(false);
        el("video-start").textContent = "关闭";
      });
  }

  /* --------------------------------------------------------------- actions */

  function bind() {
    el("btn-play").addEventListener("click", togglePlay);
    el("btn-prev-edit").addEventListener("click", function () {
      jump("edit", -1);
    });
    el("btn-next-edit").addEventListener("click", function () {
      jump("edit", 1);
    });
    el("btn-prev-mark").addEventListener("click", function () {
      jump("marker", -1);
    });
    el("btn-next-mark").addEventListener("click", function () {
      jump("marker", 1);
    });
    el("btn-open-final").addEventListener("click", function () {
      vscode.postMessage({ type: "openFinal" });
    });
    el("btn-save-code").addEventListener("click", function () {
      vscode.postMessage({ type: "saveCode" });
    });
    el("btn-export").addEventListener("click", function () {
      vscode.postMessage({ type: "exportCapsule" });
    });
    el("btn-compare").addEventListener("click", function () {
      if (video.busy) {
        return;
      }
      vscode.postMessage({ type: "compare" });
    });
    el("btn-record").addEventListener("click", function () {
      if (video.busy) {
        return;
      }
      vscode.postMessage({ type: "startRecording" });
    });
    el("btn-video").addEventListener("click", openVideoDialog);
    el("btn-summary").addEventListener("click", function () {
      var host = el("recording-summary");
      if (!host) {
        return;
      }
      if (!host.hidden) {
        host.hidden = true;
        return;
      }
      if (currentSummary) {
        renderSummary(currentSummary);
      }
    });
    var requestDelete = function () {
      if (video.busy || !currentId) {
        return;
      }
      vscode.postMessage({ type: "deleteCapsule", id: currentId });
    };
    el("btn-delete").addEventListener("click", requestDelete);
    el("summary-delete").addEventListener("click", requestDelete);
    el("summary-play").addEventListener("click", function () {
      if (!ready) {
        return;
      }
      pause();
      seekTo(0).then(function () {
        if (ready) {
          play();
        }
      });
    });
    el("summary-compare").addEventListener("click", function () {
      if (video.busy) {
        return;
      }
      vscode.postMessage({ type: "compare" });
    });
    el("summary-video").addEventListener("click", function () {
      if (!video.busy) {
        openVideoDialog();
      }
    });
    el("summary-export").addEventListener("click", function () {
      vscode.postMessage({ type: "exportCapsule" });
    });
    el("summary-dismiss").addEventListener("click", function () {
      el("recording-summary").hidden = true;
    });
    el("video-start").addEventListener("click", function () {
      if (video.busy) {
        return;
      }
      if (el("video-start").textContent === "关闭") {
        closeVideoDialog();
        return;
      }
      beginVideoExport();
    });
    el("video-cancel").addEventListener("click", function () {
      if (video.busy) {
        video.cancelled = true;
        stopVideoExport(false);
      } else {
        closeVideoDialog();
      }
    });

    var seek = el("seek");
    seek.addEventListener("pointerdown", function () {
      dragging = true;
      pause();
    });
    seek.addEventListener("input", function () {
      seekTo(Number(seek.value) || 0);
    });
    var endDrag = function () {
      dragging = false;
      updateTimeUi();
    };
    seek.addEventListener("change", endDrag);
    seek.addEventListener("pointerup", endDrag);

    el("speed").addEventListener("change", function (event) {
      speed = Number(event.target.value) || 1;
    });
    el("skip-idle").addEventListener("change", function (event) {
      skipIdle = Boolean(event.target.checked);
    });

    document.addEventListener("keydown", function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      if (event.key === "Escape" && !el("video-overlay").hidden) {
        event.preventDefault();
        if (video.busy) {
          video.cancelled = true;
          stopVideoExport(false);
        } else {
          closeVideoDialog();
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        pause();
        seekTo(playhead - (event.shiftKey ? 30000 : 5000));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        pause();
        seekTo(playhead + (event.shiftKey ? 30000 : 5000));
      } else if (event.key === "Home") {
        event.preventDefault();
        seekTo(0);
      } else if (event.key === "End") {
        event.preventDefault();
        seekTo(duration);
      }
    });
  }

  bind();
  setButtonsEnabled(false);
  vscode.postMessage({ type: "ready" });
})();
