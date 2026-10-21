/**
 * 时间胶囊录制状态机：idle → recording ⇄ paused → finalizing → idle。
 *
 * 只记录传入的单个文档：文本增量、光标、检查点与运行/提交标记。
 * 不依赖 vscode；扩展侧订阅编辑器事件后转发到 handleTextChange 等方法。
 */
"use strict";

const capsuleFormat = require("../media/shared/capsule-format");

const CURSOR_THROTTLE_MS = 150;
const CHECKPOINT_EVENTS = 300;
const CHECKPOINT_SECONDS = 60;

function sameUri(left, right) {
  return Boolean(left && right) && String(left) === String(right);
}

class TimeCapsuleRecorder {
  constructor(options = {}) {
    if (!options.store) {
      throw new Error("TimeCapsuleRecorder 需要 store");
    }
    this.store = options.store;
    this.outputChannel = options.outputChannel || null;
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.checkpointSeconds = Number(options.checkpointSeconds) > 0 ? Number(options.checkpointSeconds) : CHECKPOINT_SECONDS;
    this.checkpointEvents = Number(options.checkpointEvents) > 0 ? Number(options.checkpointEvents) : CHECKPOINT_EVENTS;
    this.cursorThrottleMs =
      Number(options.cursorThrottleMs) >= 0 ? Number(options.cursorThrottleMs) : CURSOR_THROTTLE_MS;
    this.recordCursor = options.recordCursor !== false;
    this.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => null;
    this.onLimit = typeof options.onLimit === "function" ? options.onLimit : () => null;

    this.status = "idle";
    this.session = null;
    this.limitReached = false;
    this.writeQueue = Promise.resolve();
    this.cursorTimer = null;
    this.pendingCursor = null;
    this.checkpointTimer = null;
    this.lastCheckpointAt = 0;
  }

  get isRecording() {
    return this.status === "recording" || this.status === "paused";
  }

  _iso(ms) {
    return new Date(ms).toISOString();
  }

  _elapsedMs(at = this.now()) {
    if (!this.session) {
      return 0;
    }
    const pausedNow = this.status === "paused" && this.session.pausedAt ? at - this.session.pausedAt : 0;
    return Math.max(0, at - this.session.startedAtMs - this.session.pausedTotalMs - pausedNow);
  }

  _emitState() {
    try {
      this.onStateChange(this.status, this.summary());
    } catch (_error) {
      // 状态栏刷新失败不应影响录制。
    }
  }

  _log(message) {
    if (this.outputChannel && typeof this.outputChannel.appendLine === "function") {
      this.outputChannel.appendLine(message);
    }
  }

  /** 开始录制一个文档。document 需提供 uri/fileName/getText。 */
  async start({ document, problem, language, file }) {
    if (this.status !== "idle") {
      throw new Error("已有正在录制的时间胶囊");
    }
    if (!document || typeof document.getText !== "function") {
      throw new Error("没有可录制的编辑器");
    }
    if (!problem) {
      throw new Error("当前文件不属于任何 XMUOJ 题目");
    }
    const startedAtMs = this.now();
    const text = String(document.getText() || "");
    const recording = await this.store.create({
      problem,
      language,
      file: file || this._basename(document.fileName || document.uri || ""),
      startedAt: this._iso(startedAtMs)
    });
    this.session = {
      id: recording.id,
      documentUri: String(document.uri ? document.uri.toString() : document.fileName || ""),
      problem,
      language: language || "",
      file: recording.meta.file,
      startedAtMs,
      pausedAt: 0,
      pausedTotalMs: 0,
      edits: 0,
      runs: 0,
      submits: 0,
      events: 0,
      checkpointedAt: 0,
      result: null,
      text
    };
    this.recording = recording;
    this.limitReached = false;
    this.lastCheckpointAt = startedAtMs;
    await this._append([{ t: 0, k: "cp", text }]);
    this.session.checkpointedAt = this.session.events;
    this.status = "recording";
    this._armTimers();
    this._emitState();
    this._log(`时间胶囊开始录制：${this.session.id}（${this.session.file}）`);
    return this.summary();
  }

  _basename(file) {
    const text = String(file || "");
    const index = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
    return index >= 0 ? text.slice(index + 1) : text;
  }

  _armTimers() {
    this._clearTimer(this.checkpointTimer);
    this.checkpointTimer = setInterval(() => {
      this._maybeCheckpoint(true).catch(() => null);
    }, this.checkpointSeconds * 1000);
    if (this.checkpointTimer && typeof this.checkpointTimer.unref === "function") {
      this.checkpointTimer.unref();
    }
  }

  _clearTimer(timer) {
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  }

  _matches(documentUri) {
    return Boolean(this.session) && sameUri(this.session.documentUri, String(documentUri || ""));
  }

  _append(events) {
    if (!events.length) {
      return this.writeQueue;
    }
    if (this.session) {
      this.session.events += events.length;
    }
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.recording) {
        return;
      }
      try {
        await this.store.append(this.recording, events);
      } catch (error) {
        if (error && error.code === "ELIMIT") {
          this._log(`时间胶囊达到上限：${error.message}`);
          if (!this.limitReached) {
            this.limitReached = true;
            // 不能在写入队列内部同步调用 onLimit：回调里通常会 stop() 并等待队列，造成死锁。
            const hook = this.onLimit;
            setTimeout(() => {
              try {
                Promise.resolve(hook(error)).catch(() => null);
              } catch (_hookError) {
                // 回调失败不吞掉原有上限错误。
              }
            }, 0);
          }
          return;
        }
        this._log(`写入时间胶囊失败：${error && error.message ? error.message : error}`);
      }
    });
    return this.writeQueue;
  }

  /** 编辑器文本变化：只接受录制中的那个文档。 */
  handleTextChange(event) {
    if (this.status !== "recording" || !this.session || !event || !event.document) {
      return;
    }
    const document = event.document;
    if (!this._matches(document.uri ? document.uri.toString() : document.fileName)) {
      return;
    }
    const changes = Array.isArray(event.contentChanges) ? event.contentChanges : [];
    if (!changes.length) {
      return;
    }
    const afterLength = String(document.getText() || "").length;
    let inserted = 0;
    let removed = 0;
    const compact = [];
    for (const change of changes) {
      const rangeOffset = Number(change.rangeOffset) || 0;
      const rangeLength = Number(change.rangeLength) || 0;
      const text = typeof change.text === "string" ? change.text : "";
      inserted += text.length;
      removed += rangeLength;
      compact.push({ s: rangeOffset, e: rangeOffset + rangeLength, x: text });
    }
    const beforeLength = Math.max(0, afterLength - inserted + removed);
    const eventTime = this._elapsedMs();
    this.session.edits += changes.length;
    this.session.text = String(document.getText() || "");
    this._append([{ t: eventTime, k: "e", len: beforeLength, c: compact }]);
    if (this.session.events - this.session.checkpointedAt >= this.checkpointEvents) {
      this._maybeCheckpoint(false, document).catch(() => null);
    }
  }

  /** 选区变化：节流上报，避免逐字符写盘。 */
  handleSelectionChange(event) {
    if (!this.recordCursor || this.status !== "recording" || !this.session || !event) {
      return;
    }
    const editor = event.textEditor || event;
    const document = editor && editor.document;
    const selection = editor && editor.selections && editor.selections[0] ? editor.selections[0] : editor && editor.selection;
    if (!document || !selection) {
      return;
    }
    if (!this._matches(document.uri ? document.uri.toString() : document.fileName)) {
      return;
    }
    const anchor = selection.anchor || selection.start || { offset: 0 };
    const active = selection.active || selection.end || anchor;
    this.pendingCursor = {
      a: Number(anchor.offset) || 0,
      b: Number(active.offset) || 0
    };
    if (this.cursorTimer) {
      return;
    }
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      this._flushCursor();
    }, this.cursorThrottleMs);
    if (this.cursorTimer && typeof this.cursorTimer.unref === "function") {
      this.cursorTimer.unref();
    }
  }

  _flushCursor() {
    if ((this.status !== "recording" && this.status !== "finalizing") || !this.pendingCursor) {
      this.pendingCursor = null;
      return;
    }
    const cursor = this.pendingCursor;
    this.pendingCursor = null;
    this._append([{ t: this._elapsedMs(), k: "cur", a: cursor.a, b: cursor.b }]);
  }

  handleSave(document) {
    if (this.status !== "recording" || !this.session) {
      return;
    }
    const uri = document && document.uri ? document.uri.toString() : document && document.fileName;
    if (!this._matches(uri)) {
      return;
    }
    this.mark("save", "保存文件");
  }

  /** 记录运行/提交/判题等标记。detail 只放小对象，避免把输出整段写进胶囊。 */
  mark(name, label, detail) {
    if (!this.isRecording || !this.session) {
      return;
    }
    const event = { t: this._elapsedMs(), k: "m", name: String(name || "mark") };
    if (label) {
      event.label = String(label);
    }
    if (detail !== undefined) {
      event.detail = detail;
    }
    if (name === "run") {
      this.session.runs += 1;
    } else if (name === "submit") {
      this.session.submits += 1;
    } else if (name === "result") {
      this.session.result = label || null;
    }
    this._append([event]);
    this._emitState();
  }

  async _maybeCheckpoint(force, document) {
    if (!this.session || !this.recording) {
      return;
    }
    if (this.status !== "recording" && this.status !== "finalizing") {
      return;
    }
    const now = this.now();
    const due =
      force ||
      now - this.lastCheckpointAt >= this.checkpointSeconds * 1000 ||
      this.session.events - this.session.checkpointedAt >= this.checkpointEvents;
    if (!due) {
      return;
    }
    const text = document && typeof document.getText === "function" ? document.getText() : this.session.text;
    if (typeof text !== "string") {
      return;
    }
    this.lastCheckpointAt = now;
    this.session.text = text;
    this.session.checkpointedAt = this.session.events;
    await this._append([{ t: this._elapsedMs(now), k: "cp", text }]);
  }

  pause() {
    if (this.status !== "recording") {
      return false;
    }
    this._flushCursor();
    this.status = "paused";
    this.session.pausedAt = this.now();
    this.mark("pause", "暂停录制");
    this._emitState();
    return true;
  }

  resume() {
    if (this.status !== "paused") {
      return false;
    }
    const now = this.now();
    if (this.session.pausedAt) {
      this.session.pausedTotalMs += Math.max(0, now - this.session.pausedAt);
    }
    this.session.pausedAt = 0;
    this.status = "recording";
    this.mark("resume", "继续录制");
    this._emitState();
    return true;
  }

  /** 停止递归制，收尾为正式胶囊。 */
  async stop(updates = {}) {
    if (!this.isRecording) {
      return null;
    }
    this.status = "finalizing";
    this._emitState();
    this._clearTimer(this.checkpointTimer);
    this._clearTimer(this.cursorTimer);
    this.checkpointTimer = null;
    this.cursorTimer = null;
    this._flushCursor();
    await this.writeQueue.catch(() => null);
    await this._maybeCheckpoint(true).catch(() => null);
    await this.writeQueue.catch(() => null);
    const durationMs = this._elapsedMs();
    const recording = this.recording;
    const session = this.session;
    let result = null;
    try {
      const finalUpdates = Object.assign({}, updates, {
        durationMs,
        stats: session
          ? { edits: session.edits, runs: session.runs, submits: session.submits }
          : undefined
      });
      if (!finalUpdates.result && session && session.result) {
        finalUpdates.result = session.result;
      }
      result = await this.store.stop(recording, finalUpdates);
      this._log(`时间胶囊已保存：${result.meta.id}（${Math.round(durationMs / 1000)} 秒）`);
    } finally {
      this.status = "idle";
      this.recording = null;
      this.session = null;
      this.pendingCursor = null;
      this._emitState();
    }
    return {
      meta: result ? result.meta : null,
      path: result ? result.path : "",
      sizeBytes: result ? result.sizeBytes : 0,
      durationMs,
      edits: session ? session.edits : 0,
      runs: session ? session.runs : 0,
      submits: session ? session.submits : 0,
      result: result ? result.meta.result : null
    };
  }

  /** 放弃录制：删除临时文件，不生成胶囊。 */
  async discard() {
    if (!this.isRecording) {
      return false;
    }
    this.status = "finalizing";
    this._clearTimer(this.checkpointTimer);
    this._clearTimer(this.cursorTimer);
    this.checkpointTimer = null;
    this.cursorTimer = null;
    this.pendingCursor = null;
    await this.writeQueue.catch(() => null);
    const recording = this.recording;
    this.status = "idle";
    this.recording = null;
    this.session = null;
    this._emitState();
    if (recording && recording.tempPath) {
      const fs = require("fs/promises");
      await fs.unlink(recording.tempPath).catch(() => null);
    }
    return true;
  }

  summary() {
    if (!this.session) {
      return { status: this.status };
    }
    return {
      status: this.status,
      id: this.session.id,
      problem: this.session.problem,
      language: this.session.language,
      file: this.session.file,
      documentUri: this.session.documentUri,
      durationMs: this._elapsedMs(),
      edits: this.session.edits,
      runs: this.session.runs,
      submits: this.session.submits,
      events: this.session.events,
      result: this.session.result
    };
  }

  dispose() {
    this._clearTimer(this.checkpointTimer);
    this._clearTimer(this.cursorTimer);
    this.checkpointTimer = null;
    this.cursorTimer = null;
    if (this.isRecording) {
      this._log("扩展关闭时仍有未完成的时间胶囊，可通过「恢复未完成胶囊」找回");
    }
    this.status = "idle";
    this.recording = null;
    this.session = null;
  }
}

module.exports = {
  TimeCapsuleRecorder,
  CHECKPOINT_EVENTS,
  CHECKPOINT_SECONDS,
  CURSOR_THROTTLE_MS
};
