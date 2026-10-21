/**
 * 时间胶囊回放面板：扩展侧负责读取胶囊、按检查点切片下发事件、导出与打开最终代码。
 * 页面只做渲染与播放，不直接访问磁盘或网络。
 *
 * 回放按“题目”组织：同一道题的所有尝试共享一个编辑器标签页，
 * 页面左侧的尝试列表只在扩展侧读取索引，切换尝试不会新开面板。
 */
"use strict";

const path = require("path");
const fs = require("fs/promises");
const capsuleLibrary = require("./timeCapsuleLibrary");

const LANGUAGE_IDS = {
  C: "c",
  "C++": "cpp",
  Cpp: "cpp",
  Java: "java",
  Python3: "python",
  Python: "python"
};

function createNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function densityBuckets(events, durationMs, bucketCount) {
  const buckets = new Array(bucketCount).fill(0);
  const duration = Math.max(1, durationMs);
  for (const event of events) {
    if (!event || typeof event.t !== "number") {
      continue;
    }
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((event.t / duration) * bucketCount)));
    buckets[index] += 1;
  }
  return buckets;
}

function problemTitle(problem, fallback) {
  if (!problem) {
    return fallback || "";
  }
  return [problem.displayId || problem.display_id || problem.id || "", problem.title || ""]
    .filter(Boolean)
    .join(" ")
    .trim() || fallback || "";
}

class TimeCapsulePanel {
  constructor({ context, store, outputChannel, vscode }) {
    this.context = context;
    this.store = store;
    this.outputChannel = outputChannel;
    this.vscode = vscode;
    // key: problem:<题目身份>；没有题目信息时退回 capsule:<id>。
    this.panels = new Map();
  }

  _log(message) {
    if (this.outputChannel && typeof this.outputChannel.appendLine === "function") {
      this.outputChannel.appendLine(message);
    }
  }

  _panelKey(capsule) {
    const key = capsuleLibrary.problemKeyOf(capsule && capsule.meta && capsule.meta.problem);
    return key ? `problem:${key}` : `capsule:${capsule && capsule.meta ? capsule.meta.id : ""}`;
  }

  _replayColumn() {
    const ViewColumn = this.vscode.ViewColumn || {};
    return typeof ViewColumn.Beside === "number" ? ViewColumn.Beside : ViewColumn.Active;
  }

  async _attemptsFor(problem) {
    const entries = await this.store.list().catch(() => []);
    return capsuleLibrary.attemptsForProblem(entries, problem);
  }

  /** 打开某条胶囊，并自动聚合同一道题的全部尝试。 */
  async open(id, options = {}) {
    let capsule;
    try {
      capsule = await this.store.read(id);
    } catch (error) {
      this.vscode.window.showErrorMessage(`无法打开时间胶囊：${error && error.message ? error.message : error}`);
      return null;
    }
    const key = this._panelKey(capsule);
    const existing = this.panels.get(key);
    if (existing) {
      const attempts = await this._attemptsFor(capsule.meta.problem);
      if (attempts.length) {
        existing.attempts = attempts;
      }
      existing.preview = options.preview || null;
      existing.sourcePath = options.sourcePath || existing.sourcePath || "";
      await this._switchTo(existing, capsule.meta.id, capsule);
      existing.panel.reveal(existing.panel.viewColumn || this.vscode.ViewColumn.Active, false);
      return existing.panel;
    }
    let attempts = await this._attemptsFor(capsule.meta.problem);
    if (!attempts.some((entry) => String(entry.id) === String(capsule.meta.id))) {
      attempts = capsuleLibrary.attemptsForProblem(
        [Object.assign({}, capsule.meta, { attemptNumber: capsule.meta.attempt || 1 })],
        capsule.meta.problem
      );
    }
    return this._createPanel(key, capsule, attempts, options);
  }

  /** 按题目打开回放；没有胶囊时返回 null，由调用方给出录制引导。 */
  async openProblem(problem, options = {}) {
    const key = capsuleLibrary.problemKeyOf(problem);
    if (!key) {
      return null;
    }
    const attempts = await this._attemptsFor(problem);
    if (!attempts.length) {
      return null;
    }
    const panelKey = `problem:${key}`;
    const selectedId = options.id || attempts[0].id;
    const existing = this.panels.get(panelKey);
    if (existing) {
      existing.sourcePath = options.sourcePath || existing.sourcePath || "";
      existing.preview = options.preview || null;
      const target = attempts.find((entry) => String(entry.id) === String(selectedId)) || attempts[0];
      let capsule;
      try {
        capsule = await this.store.read(target.id);
      } catch (error) {
        this.vscode.window.showErrorMessage(`无法打开时间胶囊：${error && error.message ? error.message : error}`);
        return existing.panel;
      }
      existing.attempts = attempts;
      await this._switchTo(existing, capsule.meta.id, capsule);
      existing.panel.reveal(existing.panel.viewColumn || this.vscode.ViewColumn.Active, false);
      return existing.panel;
    }
    const target = attempts.find((entry) => String(entry.id) === String(selectedId)) || attempts[0];
    let capsule;
    try {
      capsule = await this.store.read(target.id);
    } catch (error) {
      this.vscode.window.showErrorMessage(`无法打开时间胶囊：${error && error.message ? error.message : error}`);
      return null;
    }
    return this._createPanel(panelKey, capsule, attempts, options);
  }

  _createPanel(key, capsule, attempts, options) {
    const vscode = this.vscode;
    const title = problemTitle(capsule.meta.problem, capsule.meta.file);
    const panel = vscode.window.createWebviewPanel(
      "xmuojTimeCapsule",
      `回放 · ${title || capsule.meta.file}`,
      this._replayColumn(),
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      }
    );
    const entry = {
      key,
      panel,
      capsule,
      currentId: capsule.meta.id,
      attempts,
      sourcePath: options.sourcePath || "",
      preview: options.preview || null,
      video: null
    };
    this.panels.set(key, entry);
    panel.webview.html = this._html(panel.webview);
    panel.webview.onDidReceiveMessage((message) => {
      this._handle(entry, message).catch((error) => {
        this._log(`胶囊面板消息处理失败：${error && error.stack ? error.stack : error}`);
        this._post(panel, {
          type: "capsule:error",
          message: error && error.message ? error.message : String(error)
        });
      });
    });
    panel.onDidDispose(() => {
      this.panels.delete(key);
    });
    this._postInit(entry);
    return panel;
  }

  async _switchTo(entry, id, capsule) {
    if (capsule) {
      entry.capsule = capsule;
      entry.currentId = capsule.meta.id;
      this._postInit(entry);
      return;
    }
    let next;
    try {
      next = await this.store.read(id);
    } catch (error) {
      this.vscode.window.showErrorMessage(`无法打开时间胶囊：${error && error.message ? error.message : error}`);
      return;
    }
    entry.capsule = next;
    entry.currentId = next.meta.id;
    this._postInit(entry);
  }

  async openLatest() {
    const entries = await this.store.list();
    if (!entries.length) {
      this.vscode.window.showInformationMessage("还没有保存过时间胶囊。打开题目后执行「开始录制时间胶囊」。");
      return null;
    }
    return this.open(entries[0].id);
  }

  close(id) {
    for (const entry of this.panels.values()) {
      if (String(entry.currentId) === String(id)) {
        entry.panel.dispose();
        return;
      }
    }
  }

  /** 删除胶囊后同步面板；当前尝试被删时自动切换到下一条。 */
  async removeCapsule(id) {
    for (const entry of Array.from(this.panels.values())) {
      const index = entry.attempts.findIndex((item) => String(item.id) === String(id));
      if (index < 0) {
        continue;
      }
      entry.attempts = entry.attempts.filter((item) => String(item.id) !== String(id));
      if (String(entry.currentId) !== String(id)) {
        this._postInit(entry);
        continue;
      }
      // 当前尝试被删除后，摘要属于已删除的录制，不能继续展示。
      entry.preview = null;
      if (!entry.attempts.length) {
        entry.panel.dispose();
        continue;
      }
      await this._switchTo(entry, entry.attempts[0].id);
    }
  }

  _post(panel, message) {
    panel.webview.postMessage(message).then(undefined, () => null);
  }

  _html(webview) {
    const nonce = createNonce();
    const mediaRoot = this.vscode.Uri.joinPath(this.context.extensionUri, "media", "timecapsule");
    const sharedUri = webview.asWebviewUri(
      this.vscode.Uri.joinPath(this.context.extensionUri, "media", "shared", "capsule-format.js")
    );
    const styleUri = webview.asWebviewUri(this.vscode.Uri.joinPath(mediaRoot, "styles.css"));
    const scriptUri = webview.asWebviewUri(this.vscode.Uri.joinPath(mediaRoot, "player.js"));
    let html = "";
    try {
      html = require("fs").readFileSync(
        path.join(this.context.extensionPath, "media", "timecapsule", "index.html"),
        "utf8"
      );
    } catch (error) {
      this._log(`读取回放页面失败：${error.message}`);
      html = "<!doctype html><html><body>回放页面缺失，请重新安装插件。</body></html>";
    }
    return html
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{styleUri}}/g, String(styleUri))
      .replace(/{{scriptUri}}/g, String(scriptUri))
      .replace(/{{sharedUri}}/g, String(sharedUri));
  }

  _timelineSummary(capsule) {
    const events = capsule.events || [];
    const checkpoints = [];
    const markers = [];
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (!event) {
        continue;
      }
      if (event.k === "cp") {
        checkpoints.push({ index: i, t: Number(event.t) || 0 });
      } else if (event.k === "m") {
        markers.push({
          index: i,
          t: Number(event.t) || 0,
          name: event.name || "mark",
          label: event.label || "",
          detail: event.detail
        });
      }
    }
    const durationMs = Number(capsule.meta.durationMs) || (events.length ? Number(events[events.length - 1].t) || 0 : 0);
    return {
      eventCount: events.length,
      durationMs,
      checkpoints,
      markers,
      density: densityBuckets(events, durationMs, 120)
    };
  }

  /** 从胶囊元数据重建摘要；关闭横幅后仍可通过「录制摘要」再次查看。 */
  _summaryPayload(entry) {
    const meta = (entry.capsule && entry.capsule.meta) || {};
    const stats = meta.stats || {};
    return {
      title: "录制摘要",
      durationMs: Number(meta.durationMs) || 0,
      edits: Number(stats.edits) || 0,
      runs: Number(stats.runs) || 0,
      submits: Number(stats.submits) || 0,
      result: meta.result || null,
      attempt: meta.attempt || null,
      language: meta.language || "",
      file: meta.file || "",
      startedAt: meta.startedAt || "",
      endedAt: meta.endedAt || "",
      eventCount: Number(meta.eventCount) || 0,
      path: ""
    };
  }

  _attemptsPayload(entry) {
    const currentId = entry.currentId || entry.capsule.meta.id;
    const attempts = (entry.attempts || []).slice();
    if (!attempts.some((item) => String(item.id) === String(currentId))) {
      attempts.unshift(Object.assign({}, entry.capsule.meta, {
        attemptNumber: entry.capsule.meta.attempt || 1
      }));
    }
    return attempts.map((attempt) => ({
      id: attempt.id,
      attemptNumber: Number(attempt.attemptNumber) || Number(attempt.attempt) || null,
      startedAt: attempt.startedAt || "",
      durationMs: Number(attempt.durationMs) || 0,
      result: attempt.result || null,
      language: attempt.language || "",
      file: attempt.file || "",
      eventCount: Number(attempt.eventCount) || 0,
      stats: attempt.stats || null
    }));
  }

  _postInit(entry) {
    const summary = this._timelineSummary(entry.capsule);
    const config = this.vscode.workspace.getConfiguration("xmuoj");
    const preview = entry.preview || null;
    this._post(entry.panel, {
      type: "capsule:init",
      meta: entry.capsule.meta,
      currentId: entry.currentId || entry.capsule.meta.id,
      problem: entry.capsule.meta.problem || {},
      attempts: this._attemptsPayload(entry),
      timeline: summary,
      summary: this._summaryPayload(entry),
      preview,
      video: {
        fps: Math.min(60, Math.max(10, Number(config.get("timeCapsule.videoFps", 30)) || 30)),
        width: Math.min(3840, Math.max(640, Number(config.get("timeCapsule.videoWidth", 1280)) || 1280)),
        height: Math.min(2160, Math.max(360, Number(config.get("timeCapsule.videoHeight", 720)) || 720))
      }
    });
  }

  async _handle(entry, message) {
    if (!message || typeof message.type !== "string") {
      return;
    }
    const vscode = this.vscode;
    if (message.type === "ready") {
      this._postInit(entry);
      return;
    }
    if (message.type === "summaryShown") {
      // 页面确认已渲染摘要后再清空，避免面板在后台时提前丢失。
      if (!message.id || String(message.id) === String(entry.currentId)) {
        entry.preview = null;
      }
      return;
    }
    if (message.type === "selectAttempt") {
      const id = String(message.id || "");
      if (!id || !entry.attempts.some((item) => String(item.id) === id)) {
        return;
      }
      if (entry.video) {
        this._post(entry.panel, { type: "capsule:error", message: "导出视频时不能切换尝试" });
        return;
      }
      entry.preview = null;
      await this._switchTo(entry, id);
      return;
    }
    if (message.type === "events") {
      const events = entry.capsule.events;
      const start = Math.max(0, Math.min(events.length, Number(message.start) || 0));
      const count = Math.max(0, Math.min(5000, Number(message.count) || 0));
      this._post(entry.panel, {
        type: "capsule:events",
        requestId: message.requestId,
        start,
        events: events.slice(start, start + count)
      });
      return;
    }
    if (message.type === "openFinal") {
      const text = capsuleLibrary.finalTextOf(entry.capsule);
      const document = await vscode.workspace.openTextDocument({
        content: text,
        language: LANGUAGE_IDS[entry.capsule.meta.language] || "plaintext"
      });
      await vscode.window.showTextDocument(document, { preview: false });
      return;
    }
    if (message.type === "saveCode") {
      const suggested = entry.capsule.meta.file || "main.cpp";
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(
          require("os").tmpdir(),
          suggested
        )),
        saveLabel: "保存代码"
      });
      if (!target) {
        return;
      }
      const text = typeof message.text === "string" && message.text
        ? message.text
        : capsuleLibrary.finalTextOf(entry.capsule);
      await fs.writeFile(target.fsPath, text, "utf8");
      vscode.window.showInformationMessage(`代码已保存：${target.fsPath}`);
      return;
    }
    if (message.type === "exportCapsule") {
      const suggested = `${entry.currentId}.xmuojcapsule`;
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(require("os").tmpdir(), suggested)),
        saveLabel: "导出时间胶囊",
        filters: { "XMUOJ 时间胶囊": ["xmuojcapsule"] }
      });
      if (!target) {
        return;
      }
      await this.store.exportCapsule(entry.currentId, target.fsPath);
      vscode.window.showInformationMessage(`时间胶囊已导出：${target.fsPath}`);
      return;
    }
    if (message.type === "compare") {
      await this._compare(entry, message.id);
      return;
    }
    if (message.type === "deleteCapsule") {
      if (entry.video) {
        this._post(entry.panel, { type: "capsule:error", message: "导出视频时不能删除时间胶囊" });
        return;
      }
      const id = String(message.id || entry.currentId || "");
      if (!id) {
        return;
      }
      // 删除与勋章刷新统一走命令，保证二次确认和索引更新只有一套实现。
      await vscode.commands.executeCommand("xmuoj.timeCapsule.delete", { id });
      return;
    }
    if (message.type === "startRecording") {
      await vscode.commands.executeCommand("xmuoj.timeCapsule.start", {
        sourcePath: entry.sourcePath || "",
        problem: entry.capsule.meta.problem || null
      });
      return;
    }
    if (message.type === "reveal") {
      const file = this.store.pathFor(entry.currentId);
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(file)).catch(() => null);
      return;
    }
    if (message.type === "videoStart") {
      await this._startVideo(entry);
      return;
    }
    if (message.type === "videoChunk") {
      this._writeVideoChunk(entry, message.data);
      return;
    }
    if (message.type === "videoDone") {
      await this._finishVideo(entry, false);
      return;
    }
    if (message.type === "videoCancel") {
      await this._finishVideo(entry, true);
    }
  }

  /** 用 VS Code 原生 diff 对比两次尝试的最终代码，避免自己实现 diff 视图。 */
  async _compare(entry, targetId) {
    const target = targetId
      ? entry.attempts.find((item) => String(item.id) === String(targetId))
      : capsuleLibrary.compareTarget(entry.attempts, entry.currentId);
    if (!target) {
      this.vscode.window.showInformationMessage("至少需要两次尝试才能对比。");
      return;
    }
    const other = await this.store.read(target.id);
    const language = LANGUAGE_IDS[entry.capsule.meta.language] || "plaintext";
    const left = await this.vscode.workspace.openTextDocument({
      content: capsuleLibrary.finalTextOf(other),
      language
    });
    const right = await this.vscode.workspace.openTextDocument({
      content: capsuleLibrary.finalTextOf(entry.capsule),
      language
    });
    const a = capsuleLibrary.attemptLabel(Object.assign({}, target, {
      attemptNumber: target.attemptNumber || target.attempt
    }));
    const b = capsuleLibrary.attemptLabel(entry.capsule.meta);
    await this.vscode.commands.executeCommand(
      "vscode.diff",
      left.uri,
      right.uri,
      `${a} ↔ ${b} · ${problemTitle(entry.capsule.meta.problem, entry.capsule.meta.file)}`
    );
  }

  async _startVideo(entry) {
    if (entry.video) {
      this._post(entry.panel, { type: "capsule:videoError", message: "已有导出任务在进行中" });
      return;
    }
    const vscode = this.vscode;
    await this.store.init();
    await fs.mkdir(this.store.exportDir, { recursive: true });
    const base = String(entry.capsule.meta.file || "capsule").replace(/\.[^.]+$/, "");
    const safeBase = base.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "capsule";
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(this.store.exportDir, `${entry.currentId}-${safeBase}.webm`)),
      saveLabel: "导出 WebM 视频",
      filters: { "WebM 视频": ["webm"] }
    });
    if (!target) {
      this._post(entry.panel, { type: "capsule:videoError", message: "已取消导出" });
      return;
    }
    try {
      const handle = await fs.open(target.fsPath, "w");
      entry.video = {
        handle,
        path: target.fsPath,
        bytes: 0,
        failed: null,
        queue: Promise.resolve()
      };
      this._post(entry.panel, { type: "capsule:videoReady", path: target.fsPath });
    } catch (error) {
      this._post(entry.panel, {
        type: "capsule:videoError",
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  _writeVideoChunk(entry, data) {
    const video = entry.video;
    if (!video || !data) {
      return;
    }
    let bytes;
    try {
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else if (ArrayBuffer.isView(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else if (Array.isArray(data)) {
        bytes = Uint8Array.from(data);
      } else {
        return;
      }
    } catch (_error) {
      return;
    }
    const buffer = Buffer.from(bytes);
    video.bytes += buffer.length;
    video.queue = video.queue.then(() => video.handle.write(buffer)).catch((error) => {
      video.failed = video.failed || error;
    });
  }

  async _finishVideo(entry, remove) {
    const video = entry.video;
    entry.video = null;
    if (!video) {
      return;
    }
    await video.queue.catch(() => null);
    await video.handle.close().catch(() => null);
    if (remove || video.failed) {
      await fs.unlink(video.path).catch(() => null);
      this._post(entry.panel, {
        type: "capsule:videoCancelled",
        message: video.failed ? `写入失败：${video.failed.message || video.failed}` : "已取消导出"
      });
      return;
    }
    this._log(`视频导出完成：${video.path}（${video.bytes} 字节）`);
    this._post(entry.panel, {
      type: "capsule:videoFinished",
      path: video.path,
      bytes: video.bytes
    });
    this.vscode.window.showInformationMessage(`WebM 视频已导出：${video.path}`);
  }

  dispose() {
    for (const entry of this.panels.values()) {
      if (entry.video) {
        const video = entry.video;
        entry.video = null;
        video.queue
          .catch(() => null)
          .then(() => video.handle.close().catch(() => null))
          .then(() => fs.unlink(video.path).catch(() => null))
          .catch(() => null);
      }
      entry.panel.dispose();
    }
    this.panels.clear();
  }
}

module.exports = {
  TimeCapsulePanel,
  densityBuckets
};
