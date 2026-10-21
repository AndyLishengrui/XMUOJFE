/**
 * 时间胶囊存储层：录制中的 NDJSON 临时文件、停止时 gzip 成 .xmuojcapsule、
 * 列表/读取/导出/导入/删除与崩溃恢复。纯 Node，不依赖 vscode，便于测试。
 */
"use strict";

const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const capsuleFormat = require("../media/shared/capsule-format");
const capsuleLibrary = require("./timeCapsuleLibrary");

const INDEX_VERSION = 1;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_EVENTS = 500000;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function capsuleError(code, message, extra) {
  const error = new Error(message);
  error.code = code;
  if (extra && typeof extra === "object") {
    Object.assign(error, extra);
  }
  return error;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function makeCapsuleId(date) {
  const when = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const stamp =
    `${when.getUTCFullYear()}${pad(when.getUTCMonth() + 1)}${pad(when.getUTCDate())}` +
    `T${pad(when.getUTCHours())}${pad(when.getUTCMinutes())}${pad(when.getUTCSeconds())}`;
  return `${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

function serializeEvent(event) {
  return JSON.stringify(event);
}

function buildCapsuleText(meta, events) {
  const lines = [JSON.stringify(meta)];
  for (const event of events) {
    lines.push(serializeEvent(event));
  }
  return `${lines.join("\n")}\n`;
}

function lastEventTime(events) {
  let last = 0;
  for (const event of events) {
    if (event && typeof event.t === "number" && isFinite(event.t) && event.t > last) {
      last = event.t;
    }
  }
  return last;
}

class TimeCapsuleStore {
  constructor(rootDir, options = {}) {
    if (!rootDir) {
      throw capsuleError("EINVAL", "时间胶囊目录不能为空");
    }
    this.rootDir = rootDir;
    this.maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : DEFAULT_MAX_BYTES;
    this.maxEvents = Number(options.maxEvents) > 0 ? Number(options.maxEvents) : DEFAULT_MAX_EVENTS;
    this.now = typeof options.now === "function" ? options.now : () => new Date();
    this.indexPath = path.join(rootDir, "index.json");
    this.recordingDir = path.join(rootDir, ".recording");
    this.exportDir = path.join(rootDir, "exports");
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.mkdir(this.recordingDir, { recursive: true });
    return this;
  }

  isoNow() {
    return this.now().toISOString();
  }

  pathFor(id) {
    if (!SAFE_ID_RE.test(String(id || ""))) {
      throw capsuleError("EINVAL", `非法胶囊 id：${id}`);
    }
    return path.join(this.rootDir, `${id}.xmuojcapsule`);
  }

  recordingPathFor(id) {
    if (!SAFE_ID_RE.test(String(id || ""))) {
      throw capsuleError("EINVAL", `非法胶囊 id：${id}`);
    }
    return path.join(this.recordingDir, `${id}.ndjson`);
  }

  /** 开始录制：只写 header，事件随后逐行追加。 */
  async create({ problem, language, file, startedAt, id } = {}) {
    if (!problem || typeof problem !== "object") {
      throw capsuleError("EINVAL", "开始录制需要题目信息");
    }
    if (!file) {
      throw capsuleError("EINVAL", "开始录制需要文件名");
    }
    await this.init();
    const capsuleId = id ? String(id) : makeCapsuleId(this.now());
    if (!SAFE_ID_RE.test(capsuleId)) {
      throw capsuleError("EINVAL", `非法胶囊 id：${capsuleId}`);
    }
    const tempPath = this.recordingPathFor(capsuleId);
    const targetPath = this.pathFor(capsuleId);
    try {
      await fs.access(targetPath);
      throw capsuleError("EEXIST", `胶囊已存在：${capsuleId}`);
    } catch (error) {
      if (error && error.code === "EEXIST") {
        throw error;
      }
      // 文件不存在，继续。
    }
    const problemKey = capsuleLibrary.problemKeyOf(problem);
    const meta = {
      format: capsuleFormat.FORMAT,
      v: capsuleFormat.VERSION,
      id: capsuleId,
      problem: {
        id: problem.id !== undefined ? problem.id : problem.problemId,
        displayId: problem.displayId || problem.display_id || "",
        title: problem.title || "",
        key: problemKey
      },
      // 尝试序号在创建时固定，删除旧胶囊后仍能保留“第 N 次”的语义。
      attempt: await this._nextAttempt(problemKey),
      language: language || "",
      file,
      startedAt: startedAt || this.isoNow(),
      endedAt: null,
      durationMs: 0,
      result: null,
      eventCount: 0,
      checkpointCount: 0,
      stats: { edits: 0, runs: 0, submits: 0 }
    };
    await fs.writeFile(tempPath, `${JSON.stringify(meta)}\n`, "utf8");
    return {
      id: capsuleId,
      tempPath,
      meta,
      bytes: Buffer.byteLength(JSON.stringify(meta), "utf8") + 1,
      eventCount: 0,
      lastTime: 0
    };
  }

  /**
   * 追加事件。达到大小/事件上限时抛出 code=ELIMIT，由调用方停止录制。
   * 返回更新后的统计，便于状态栏与自动停止判断。
   */
  async append(recording, events) {
    if (!recording || !recording.tempPath) {
      throw capsuleError("EINVAL", "没有正在进行的录制");
    }
    const list = Array.isArray(events) ? events.filter((event) => event && typeof event === "object") : [];
    if (!list.length) {
      return { bytes: recording.bytes || 0, eventCount: recording.eventCount || 0 };
    }
    let chunk = "";
    for (const event of list) {
      chunk += `${serializeEvent(event)}\n`;
    }
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    const nextBytes = (recording.bytes || 0) + chunkBytes;
    const nextCount = (recording.eventCount || 0) + list.length;
    if (nextBytes > this.maxBytes) {
      throw capsuleError("ELIMIT", "时间胶囊已达到大小上限", { limit: "bytes", maxBytes: this.maxBytes });
    }
    if (nextCount > this.maxEvents) {
      throw capsuleError("ELIMIT", "时间胶囊已达到事件数量上限", { limit: "events", maxEvents: this.maxEvents });
    }
    await fs.appendFile(recording.tempPath, chunk, "utf8");
    recording.bytes = nextBytes;
    recording.eventCount = nextCount;
    for (const event of list) {
      if (typeof event.t === "number" && isFinite(event.t) && event.t > (recording.lastTime || 0)) {
        recording.lastTime = event.t;
      }
    }
    return { bytes: recording.bytes, eventCount: recording.eventCount };
  }

  /** 停止并压缩为正式胶囊；tempFile 删除失败不影响结果。 */
  async stop(recording, updates = {}) {
    if (!recording || !recording.tempPath) {
      throw capsuleError("EINVAL", "没有正在进行的录制");
    }
    const text = await fs.readFile(recording.tempPath, "utf8");
    const parsed = capsuleFormat.parseCapsule(text);
    if (!parsed.ok) {
      throw capsuleError("EBADFILE", parsed.error || "胶囊临时文件损坏");
    }
    return this._finalize(parsed.meta, parsed.events, recording.tempPath, updates);
  }

  async _finalize(meta, events, tempPath, updates = {}) {
    const id = meta.id;
    const targetPath = this.pathFor(id);
    const durationMs =
      typeof updates.durationMs === "number" && isFinite(updates.durationMs)
        ? Math.max(0, Math.round(updates.durationMs))
        : lastEventTime(events);
    const stats = updates.stats && typeof updates.stats === "object"
      ? {
          edits: Math.max(0, Number(updates.stats.edits) || 0),
          runs: Math.max(0, Number(updates.stats.runs) || 0),
          submits: Math.max(0, Number(updates.stats.submits) || 0)
        }
      : meta.stats || null;
    const finalMeta = Object.assign({}, meta, {
      endedAt: updates.endedAt || this.isoNow(),
      durationMs,
      result: updates.result || meta.result || null,
      eventCount: events.length,
      checkpointCount: events.filter((event) => event && event.k === "cp").length,
      stats
    });
    const payload = zlib.gzipSync(Buffer.from(buildCapsuleText(finalMeta, events), "utf8"), { level: 9 });
    const stagingPath = `${targetPath}.tmp`;
    await fs.writeFile(stagingPath, payload);
    await fs.rename(stagingPath, targetPath);
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => null);
    }
    await this._upsertIndex(finalMeta, payload.length);
    return { meta: finalMeta, path: targetPath, sizeBytes: payload.length };
  }

  async list() {
    await this.init();
    let entries = await this._readIndex();
    if (!entries) {
      entries = await this.rebuildIndex();
    }
    return entries.slice().sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  }

  async read(id) {
    const file = this.pathFor(id);
    let buffer;
    try {
      buffer = await fs.readFile(file);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        throw capsuleError("ENOENT", `找不到胶囊：${id}`);
      }
      throw error;
    }
    let text;
    try {
      text = zlib.gunzipSync(buffer).toString("utf8");
    } catch (_error) {
      throw capsuleError("EBADFILE", "胶囊文件无法解压，可能已损坏");
    }
    const parsed = capsuleFormat.parseCapsule(text);
    if (!parsed.ok) {
      throw capsuleError("EBADFILE", parsed.error || "胶囊文件损坏");
    }
    return { meta: parsed.meta, events: parsed.events, path: file };
  }

  async readMeta(id) {
    return (await this.read(id)).meta;
  }

  async exportCapsule(id, destinationPath) {
    const source = this.pathFor(id);
    await fs.access(source).catch(() => {
      throw capsuleError("ENOENT", `找不到胶囊：${id}`);
    });
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(source, destinationPath);
    return destinationPath;
  }

  /** 导入胶囊；id 冲突时另存为新 id，不改动原文件内容。 */
  async importCapsule(sourcePath, options = {}) {
    let buffer;
    try {
      buffer = await fs.readFile(sourcePath);
    } catch (error) {
      throw capsuleError("ENOENT", `无法读取胶囊文件：${sourcePath}`);
    }
    let text;
    try {
      text = zlib.gunzipSync(buffer).toString("utf8");
    } catch (_error) {
      throw capsuleError("EBADFILE", "不是有效的胶囊文件（无法解压）");
    }
    const parsed = capsuleFormat.parseCapsule(text);
    if (!parsed.ok) {
      throw capsuleError("EBADFILE", parsed.error || "胶囊文件损坏");
    }
    await this.init();
    let id = options.id ? String(options.id) : parsed.meta.id;
    if (!SAFE_ID_RE.test(id)) {
      id = makeCapsuleId(this.now());
    }
    let targetPath = this.pathFor(id);
    let suffix = 2;
    while (await this._exists(targetPath)) {
      id = `${parsed.meta.id}-${suffix}`;
      suffix += 1;
      targetPath = this.pathFor(id);
    }
    const meta = Object.assign({}, parsed.meta, { id });
    const payload =
      id === parsed.meta.id
        ? buffer
        : zlib.gzipSync(Buffer.from(buildCapsuleText(meta, parsed.events), "utf8"), { level: 9 });
    await fs.writeFile(targetPath, payload);
    await this._upsertIndex(meta, payload.length);
    return { meta, path: targetPath, sizeBytes: payload.length };
  }

  async deleteCapsule(id) {
    const file = this.pathFor(id);
    await fs.unlink(file).catch((error) => {
      if (error && error.code === "ENOENT") {
        throw capsuleError("ENOENT", `找不到胶囊：${id}`);
      }
      throw error;
    });
    const entries = (await this._readIndex()) || [];
    await this._writeIndex(entries.filter((entry) => entry.id !== id));
    return true;
  }

  /** 扫描未完成的临时录制（崩溃/断电恢复入口）。 */
  async recover() {
    await this.init();
    let names = [];
    try {
      names = await fs.readdir(this.recordingDir);
    } catch (_error) {
      return [];
    }
    const found = [];
    for (const name of names) {
      if (!name.endsWith(".ndjson")) {
        continue;
      }
      const file = path.join(this.recordingDir, name);
      try {
        const text = await fs.readFile(file, "utf8");
        const parsed = capsuleFormat.parseCapsule(text);
        if (!parsed.ok) {
          continue;
        }
        const stat = await fs.stat(file);
        found.push({
          id: parsed.meta.id,
          file,
          meta: parsed.meta,
          events: parsed.events.length,
          bytes: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
      } catch (_error) {
        // 损坏的临时文件保留在磁盘上，等待用户手动处理。
      }
    }
    return found.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  }

  /** 把一条未完成的录制收尾成正式胶囊。 */
  async recoverOne(file, updates = {}) {
    const text = await fs.readFile(file, "utf8");
    const parsed = capsuleFormat.parseCapsule(text);
    if (!parsed.ok) {
      throw capsuleError("EBADFILE", parsed.error || "临时录制文件损坏");
    }
    const result = await this._finalize(parsed.meta, parsed.events, file, updates);
    return result;
  }

  /** 扫描胶囊目录，从文件本身读取摘要（index.json 只作为缓存）。 */
  async _scanCapsuleEntries() {
    await this.init();
    let names = [];
    try {
      names = await fs.readdir(this.rootDir);
    } catch (_error) {
      names = [];
    }
    const entries = [];
    for (const name of names) {
      if (!name.endsWith(".xmuojcapsule")) {
        continue;
      }
      const file = path.join(this.rootDir, name);
      try {
        const buffer = await fs.readFile(file);
        const parsed = capsuleFormat.parseCapsule(zlib.gunzipSync(buffer).toString("utf8"));
        if (!parsed.ok) {
          continue;
        }
        entries.push(this._indexEntry(parsed.meta, buffer.length));
      } catch (_error) {
        // 跳过无法读取的文件，不阻塞其余胶囊。
      }
    }
    return entries;
  }

  /** 从目录里的胶囊文件重建 index.json。 */
  async rebuildIndex() {
    const entries = await this._scanCapsuleEntries();
    await this._writeIndex(entries);
    return entries;
  }

  /**
   * 启动/升级时的索引整理：
   *  - 以胶囊文件为准重建索引（补齐丢失摘要、移除已删除文件的残留）；
   *  - 为旧胶囊补上 problem.key；
   *  - 为没有尝试序号的旧胶囊按开始时间补 1..N，保留已有序号。
   * 只改写 index.json，不修改任何胶囊文件。
   */
  async repairIndex() {
    const entries = await this._scanCapsuleEntries();
    const repaired = this._backfillIndexEntries(entries);
    await this._writeIndex(entries);
    return { entries, repaired };
  }

  _backfillIndexEntries(entries) {
    let changed = false;
    for (const entry of entries) {
      const problemKey = capsuleLibrary.problemKeyOf(entry && entry.problem);
      if (!problemKey) {
        continue;
      }
      if (!entry.problemKey) {
        entry.problemKey = problemKey;
        changed = true;
      }
      if (!entry.problem || typeof entry.problem !== "object") {
        entry.problem = { key: problemKey };
        changed = true;
      } else if (entry.problem.key !== problemKey) {
        entry.problem = Object.assign({}, entry.problem, { key: problemKey });
        changed = true;
      }
    }

    const groups = new Map();
    for (const entry of entries) {
      const key = capsuleLibrary.entryProblemKey(entry);
      if (!key) {
        continue;
      }
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(entry);
    }
    const byStartedAt = (left, right) => (
      String(left.startedAt || "").localeCompare(String(right.startedAt || ""))
      || String(left.id || "").localeCompare(String(right.id || ""))
    );
    for (const group of groups.values()) {
      const used = group
        .map((entry) => Number(entry.attempt))
        .filter((value) => Number.isFinite(value) && value > 0);
      let max = used.length ? Math.max(...used) : 0;
      const missing = group
        .filter((entry) => !(Number(entry.attempt) > 0))
        .sort(byStartedAt);
      for (const entry of missing) {
        max += 1;
        entry.attempt = max;
        changed = true;
      }
    }
    return changed;
  }

  // ------------------------------------------------------------- internals

  _indexEntry(meta, sizeBytes) {
    const problemKey =
      (meta.problem && meta.problem.key) || capsuleLibrary.problemKeyOf(meta.problem);
    return {
      id: meta.id,
      problem: meta.problem,
      problemKey,
      attempt: Number(meta.attempt) || null,
      language: meta.language || "",
      file: meta.file || "",
      startedAt: meta.startedAt || "",
      endedAt: meta.endedAt || null,
      durationMs: Number(meta.durationMs) || 0,
      result: meta.result || null,
      eventCount: Number(meta.eventCount) || 0,
      checkpointCount: Number(meta.checkpointCount) || 0,
      stats: meta.stats || null,
      sizeBytes: Number(sizeBytes) || 0
    };
  }

  async _nextAttempt(problemKey) {
    if (!problemKey) {
      return null;
    }
    const entries = (await this._readIndex()) || [];
    const used = entries
      .filter((entry) => capsuleLibrary.entryProblemKey(entry) === problemKey)
      .map((entry) => Number(entry.attempt) || 0);
    return Math.max(0, ...used) + 1;
  }

  async _readIndex() {
    try {
      const text = await fs.readFile(this.indexPath, "utf8");
      const data = JSON.parse(text);
      if (!data || data.version !== INDEX_VERSION || !Array.isArray(data.entries)) {
        return null;
      }
      return data.entries;
    } catch (_error) {
      return null;
    }
  }

  async _writeIndex(entries) {
    const payload = JSON.stringify({ version: INDEX_VERSION, entries }, null, 2);
    const staging = `${this.indexPath}.tmp`;
    await fs.writeFile(staging, payload, "utf8");
    await fs.rename(staging, this.indexPath);
  }

  async _upsertIndex(meta, sizeBytes) {
    const entries = (await this._readIndex()) || [];
    const entry = this._indexEntry(meta, sizeBytes);
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      entries[index] = entry;
    } else {
      entries.push(entry);
    }
    await this._writeIndex(entries);
  }

  async _exists(file) {
    try {
      await fs.access(file);
      return true;
    } catch (_error) {
      return false;
    }
  }
}

module.exports = {
  TimeCapsuleStore,
  makeCapsuleId,
  INDEX_VERSION,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_EVENTS
};
