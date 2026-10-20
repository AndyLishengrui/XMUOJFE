/**
 * 旧布局迁移：contest-<id>/<题>/ 与 problemsets/<题>/ → problems/<题>/
 *
 * 安全原则：
 *  - 不删除任何非空目录；
 *  - 无元数据 / 元数据损坏 / 符号链接 / 正在编辑器里打开的题目一律跳过；
 *  - rename 优先，跨设备才 copy → 逐文件校验 → 删除源；
 *  - 每条完成后立即写清单与 journal，可断点续跑；
 *  - 迁移前备份 v1 元数据，清单支持回滚。
 *
 * 本模块不依赖 vscode（打开中的文件由调用方通过 isDirectoryOpen 注入），纯 Node。
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const store = require("./workspaceStore");

const LOCK_TTL_MS = 10 * 60 * 1000;
const HASH_SIZE_LIMIT = 2 * 1024 * 1024;
const HASH_TOTAL_LIMIT = 64 * 1024 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function metaPath(root) {
  return path.join(root, store.META_DIR_NAME);
}

function manifestPath(root) {
  return path.join(metaPath(root), store.MIGRATION_FILE_NAME);
}

function journalPath(root) {
  return path.join(metaPath(root), store.MIGRATION_LOG_FILE_NAME);
}

function lockPath(root) {
  return path.join(metaPath(root), store.MIGRATION_LOCK_FILE_NAME);
}

async function readJsonSafe(filePath) {
  try {
    return { value: JSON.parse(await fs.readFile(filePath, "utf8")), exists: true, corrupt: false };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { value: null, exists: false, corrupt: false };
    }
    return { value: null, exists: true, corrupt: true };
  }
}

// ---------------------------------------------------------------------------
// 迁移锁
// ---------------------------------------------------------------------------

async function readLock(root) {
  const { value } = await readJsonSafe(lockPath(root));
  return value && typeof value === "object" ? value : null;
}

function lockIsStale(lock) {
  if (!lock || !lock.startedAt) {
    return true;
  }
  const started = Date.parse(lock.startedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  if (Date.now() - started > LOCK_TTL_MS) {
    return true;
  }
  // 同一台机器上进程已不存在 → 视为残留锁
  if (lock.hostname === os.hostname() && Number.isFinite(Number(lock.pid))) {
    try {
      process.kill(Number(lock.pid), 0);
      return false;
    } catch (error) {
      return Boolean(error && error.code === "ESRCH");
    }
  }
  return false;
}

/**
 * 获取迁移锁。返回 { acquired, holder }。
 * 另一个窗口持有有效锁时 acquired=false，调用方应跳过本次迁移。
 */
async function acquireMigrationLock(root) {
  const target = lockPath(root);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const payload = JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: nowIso()
  });
  try {
    await fs.writeFile(target, payload, { encoding: "utf8", flag: "wx" });
    return { acquired: true, holder: null };
  } catch (error) {
    if (!error || error.code !== "EEXIST") {
      throw error;
    }
  }
  const holder = await readLock(root);
  if (holder && !lockIsStale(holder)) {
    return { acquired: false, holder };
  }
  // 残留锁：覆盖
  await fs.writeFile(target, payload, "utf8");
  return { acquired: true, holder: null, tookOver: Boolean(holder) };
}

async function releaseMigrationLock(root) {
  const holder = await readLock(root);
  if (holder && Number(holder.pid) !== process.pid) {
    return false;
  }
  try {
    await fs.unlink(lockPath(root));
    return true;
  } catch (_error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 清单与 journal
// ---------------------------------------------------------------------------

function createEmptyManifest() {
  return {
    version: 1,
    startedAt: null,
    completedAt: null,
    entries: [],
    removedParents: []
  };
}

async function readMigrationManifest(root) {
  const { value, corrupt } = await readJsonSafe(manifestPath(root));
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) {
    return Object.assign(createEmptyManifest(), { corrupt });
  }
  return Object.assign(createEmptyManifest(), value);
}

async function writeMigrationManifest(root, manifest) {
  await store.atomicWriteJson(manifestPath(root), manifest);
}

async function appendJournal(root, entry) {
  await fs.mkdir(metaPath(root), { recursive: true });
  await fs.appendFile(journalPath(root), JSON.stringify(entry) + "\n", "utf8");
}

async function readJournalFromSet(root) {
  const completed = new Set();
  let text = "";
  try {
    text = await fs.readFile(journalPath(root), "utf8");
  } catch (_error) {
    return completed;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed);
      if (entry && entry.from && (entry.status === "moved" || entry.status === "skipped")) {
        completed.add(entry.from);
      }
    } catch (_error) {
      /* 半截行：忽略，重新处理即可 */
    }
  }
  return completed;
}

/** 回滚后把对应 from 从 journal 里移除，避免下次迁移误判为“已完成”。 */
async function rewriteJournalWithout(root, fromSet) {
  if (!fromSet || !fromSet.size) {
    return;
  }
  let text = "";
  try {
    text = await fs.readFile(journalPath(root), "utf8");
  } catch (_error) {
    return;
  }
  const kept = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed);
      if (entry && entry.from && fromSet.has(entry.from)) {
        continue;
      }
    } catch (_error) {
      continue;
    }
    kept.push(trimmed);
  }
  if (kept.length) {
    await fs.writeFile(journalPath(root), kept.join("\n") + "\n", "utf8");
  } else {
    await fs.unlink(journalPath(root)).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// 文件系统工具
// ---------------------------------------------------------------------------

async function lstatSafe(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listTree(rootDir, relative = "") {
  const result = [];
  const absolute = relative ? path.join(rootDir, relative) : rootDir;
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const abs = path.join(rootDir, rel);
    if (entry.isSymbolicLink()) {
      result.push({ rel, type: "symlink", target: await fs.readlink(abs), size: 0 });
    } else if (entry.isDirectory()) {
      result.push({ rel, type: "dir", size: 0 });
      result.push(...(await listTree(rootDir, rel)));
    } else if (entry.isFile()) {
      const stat = await fs.lstat(abs);
      result.push({ rel, type: "file", size: stat.size });
    }
  }
  return result;
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const stream = require("fs").createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * 目录指纹：文件数 + 总字节数（回滚时判断目标是否被改动）。
 * 小文件额外算 sha1，便于精确定位差异。
 */
async function computeFingerprint(rootDir) {
  const tree = await listTree(rootDir);
  const files = tree.filter((item) => item.type === "file");
  const fingerprint = {
    fileCount: files.length,
    totalBytes: files.reduce((sum, item) => sum + item.size, 0),
    hashCount: 0,
    hashes: {}
  };
  let hashBudget = HASH_TOTAL_LIMIT;
  for (const file of files.slice().sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (file.size > HASH_SIZE_LIMIT || hashBudget <= 0) {
      continue;
    }
    fingerprint.hashes[file.rel] = await hashFile(path.join(rootDir, file.rel));
    fingerprint.hashCount += 1;
    hashBudget -= file.size;
  }
  return fingerprint;
}

async function copyTree(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      const linkTarget = await fs.readlink(from);
      await fs.symlink(linkTarget, to);
    } else if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
      const stat = await fs.lstat(from);
      await fs.chmod(to, stat.mode & 0o777);
      await fs.utimes(to, stat.atime, stat.mtime);
    }
  }
}

/**
 * 校验复制结果：相对路径集合、文件数、总字节数（以及双方都算出的哈希）。
 * 返回 { ok, reason }。
 */
async function verifyCopy(sourceDir, targetDir) {
  const [sourceTree, targetTree] = await Promise.all([listTree(sourceDir), listTree(targetDir)]);
  const toMap = (tree) => new Map(tree.map((item) => [item.rel, item]));
  const sourceMap = toMap(sourceTree);
  const targetMap = toMap(targetTree);
  if (sourceMap.size !== targetMap.size) {
    return { ok: false, reason: `条目数不一致（${sourceMap.size} → ${targetMap.size}）` };
  }
  for (const [rel, sourceItem] of sourceMap) {
    const targetItem = targetMap.get(rel);
    if (!targetItem || targetItem.type !== sourceItem.type) {
      return { ok: false, reason: `缺少条目 ${rel}` };
    }
    if (sourceItem.type === "file" && targetItem.size !== sourceItem.size) {
      return { ok: false, reason: `文件大小不一致 ${rel}` };
    }
    if (sourceItem.type === "symlink" && targetItem.target !== sourceItem.target) {
      return { ok: false, reason: `符号链接目标不一致 ${rel}` };
    }
  }
  const sourceBytes = sourceTree.filter((item) => item.type === "file").reduce((sum, item) => sum + item.size, 0);
  const targetBytes = targetTree.filter((item) => item.type === "file").reduce((sum, item) => sum + item.size, 0);
  if (sourceBytes !== targetBytes) {
    return { ok: false, reason: `总字节数不一致（${sourceBytes} → ${targetBytes}）` };
  }
  let hashBudget = HASH_TOTAL_LIMIT;
  for (const item of sourceTree) {
    if (item.type !== "file" || item.size > HASH_SIZE_LIMIT || hashBudget <= 0) {
      continue;
    }
    const [sourceHash, targetHash] = await Promise.all([
      hashFile(path.join(sourceDir, item.rel)),
      hashFile(path.join(targetDir, item.rel))
    ]);
    if (sourceHash !== targetHash) {
      return { ok: false, reason: `内容不一致 ${item.rel}` };
    }
    hashBudget -= item.size;
  }
  return { ok: true };
}

/**
 * 先 rename；跨设备（EXDEV）时 copy → verify → 删除源。
 * 返回 { method: "rename"|"copy" }。
 */
async function moveDirectory(sourceDir, targetDir) {
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  try {
    await fs.rename(sourceDir, targetDir);
    return { method: "rename" };
  } catch (error) {
    if (!error || error.code !== "EXDEV") {
      throw error;
    }
  }
  const existingTarget = await lstatSafe(targetDir);
  if (existingTarget) {
    throw new Error(`目标目录已存在：${targetDir}`);
  }
  await copyTree(sourceDir, targetDir);
  const verified = await verifyCopy(sourceDir, targetDir);
  if (!verified.ok) {
    // 校验失败：保留源目录，标记目标待清理
    const cleanupError = new Error(`复制校验失败：${verified.reason}`);
    cleanupError.requiresCleanup = true;
    cleanupError.targetDir = targetDir;
    throw cleanupError;
  }
  await fs.rm(sourceDir, { recursive: true, force: true });
  return { method: "copy" };
}

// ---------------------------------------------------------------------------
// 迁移计划
// ---------------------------------------------------------------------------

async function findLegacyProblemDirs(rootPath) {
  const root = path.resolve(String(rootPath || ""));
  const result = [];
  const containers = [];
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (store.LEGACY_CONTEST_DIR_RE.test(entry.name) || entry.name === store.LEGACY_PROBLEMSET_DIR_NAME) {
        containers.push(entry.name);
      }
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
    return result;
  }
  for (const container of containers) {
    const containerDir = path.join(root, container);
    let entries = [];
    try {
      entries = await fs.readdir(containerDir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name === ".DS_Store") {
        continue;
      }
      result.push({
        absoluteDir: path.join(containerDir, entry.name),
        relativeDir: path.posix.join(container, entry.name),
        container,
        isSymlink: entry.isSymbolicLink(),
        contestId: store.LEGACY_CONTEST_DIR_RE.test(container)
          ? Number(container.slice("contest-".length))
          : null
      });
    }
  }
  return result;
}

/**
 * 生成迁移计划（只读）。
 * options: { baseUrl, index, isDirectoryOpen }
 * 返回 { entries, summary, manifest }。
 */
async function planMigration(rootPath, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const baseUrl = store.normalizeBaseUrl(options.baseUrl);
  const index = options.index || (await store.ensureWorkspaceIndex(root, { baseUrl })).index;
  const isDirectoryOpen = typeof options.isDirectoryOpen === "function" ? options.isDirectoryOpen : () => false;
  const legacyDirs = await findLegacyProblemDirs(root);
  const entries = [];
  const seenIdentities = new Set();

  for (const candidate of legacyDirs) {
    const base = {
      from: candidate.relativeDir,
      to: null,
      identity: null,
      contestId: candidate.contestId,
      contestTitle: null
    };

    if (candidate.isSymlink) {
      entries.push(Object.assign({}, base, { action: "skip", reason: "symlink" }));
      continue;
    }
    if (isDirectoryOpen(candidate.absoluteDir)) {
      entries.push(Object.assign({}, base, { action: "skip", reason: "open-in-editor" }));
      continue;
    }

    const read = await store.readProblemMetadata(candidate.absoluteDir, { baseUrl });
    if (!read.exists) {
      entries.push(Object.assign({}, base, { action: "skip", reason: "no-metadata" }));
      continue;
    }
    if (read.corrupt || !read.metadata || read.metadata.problemId === null || read.metadata.problemId === undefined) {
      entries.push(Object.assign({}, base, { action: "skip", reason: "corrupt-metadata" }));
      continue;
    }

    const metadata = read.metadata;
    const identity = store.buildProblemIdentity(baseUrl || metadata.baseUrl, metadata.problemId);
    const prepared = Object.assign({}, base, {
      identity,
      problemId: metadata.problemId,
      displayId: metadata.displayId,
      title: metadata.title,
      contestTitle: metadata.contestTitle || null
    });

    if (seenIdentities.has(identity)) {
      entries.push(Object.assign(prepared, { action: "duplicate", reason: "duplicate-in-plan" }));
      continue;
    }

    let resolved;
    try {
      resolved = await store.resolveProblemDir(
        root,
        { id: metadata.problemId, display_id: metadata.displayId, title: metadata.title },
        null,
        { baseUrl: baseUrl || metadata.baseUrl, index }
      );
    } catch (error) {
      entries.push(Object.assign(prepared, { action: "skip", reason: `resolve-failed: ${error.message}` }));
      continue;
    }

    const targetRelative = store.toPosixRelative(root, resolved.problemDir);
    const preparedWithTarget = Object.assign(prepared, { to: targetRelative });

    if (resolved.reused) {
      // 新布局里已有同一身份的目录：保留旧目录作为副本，不覆盖
      entries.push(Object.assign(preparedWithTarget, { action: "duplicate", reason: "target-exists" }));
      continue;
    }

    seenIdentities.add(identity);
    entries.push(Object.assign(preparedWithTarget, { action: "move" }));
  }

  const summary = entries.reduce(
    (acc, entry) => {
      if (entry.action === "move") {
        acc.move += 1;
      } else if (entry.action === "skip") {
        acc.skip += 1;
      } else {
        acc.duplicate += 1;
      }
      return acc;
    },
    { move: 0, skip: 0, duplicate: 0 }
  );

  return {
    entries,
    summary,
    manifest: {
      version: 1,
      startedAt: null,
      completedAt: null,
      entries: [],
      removedParents: []
    }
  };
}

// ---------------------------------------------------------------------------
// 执行迁移
// ---------------------------------------------------------------------------

function relativeToAbsolute(root, relative) {
  return path.join(root, ...String(relative).split("/"));
}

async function backupV1Metadata(root, metadataPath, problemId) {
  const backupDir = path.join(metaPath(root), store.BACKUP_V1_DIR_NAME);
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${problemId}.json`);
  if (await store.pathExists(backupPath)) {
    return backupPath;
  }
  await fs.copyFile(metadataPath, backupPath);
  return backupPath;
}

async function upgradeMigratedMetadata(root, entry, absoluteTargetDir) {
  const metadataPath = path.join(absoluteTargetDir, store.METADATA_FILE_NAME);
  if (await store.pathExists(metadataPath)) {
    await backupV1Metadata(root, metadataPath, entry.problemId);
  }
  const patch = {
    baseUrl: store.parseProblemIdentity(entry.identity).baseUrl,
    problemId: entry.problemId,
    identity: entry.identity
  };
  if (entry.contestId !== undefined && entry.contestId !== null) {
    patch.contestId = entry.contestId;
  }
  const metadata = await store.writeProblemMetadata(absoluteTargetDir, patch);
  return metadata;
}

async function cleanupEmptyLegacyParents(root, containers, removedParents) {
  for (const container of containers) {
    const containerDir = path.join(root, container);
    let hasEntries;
    try {
      hasEntries = await store.directoryHasEntries(containerDir);
    } catch (_error) {
      continue;
    }
    if (hasEntries) {
      continue;
    }
    try {
      await fs.rmdir(containerDir);
      if (!removedParents.includes(container)) {
        removedParents.push(container);
      }
    } catch (_error) {
      /* 非空/权限问题：保留 */
    }
  }
}

/**
 * 执行迁移计划。options: { manifest, onProgress, token }
 * 返回 { locked, holder, moved, skipped, duplicate, failed, removedParents, entries, manifest }。
 */
async function applyMigration(rootPath, plan, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const lock = await acquireMigrationLock(root);
  if (!lock.acquired) {
    return {
      locked: false,
      holder: lock.holder,
      moved: 0,
      skipped: 0,
      duplicate: 0,
      failed: 0,
      removedParents: [],
      entries: []
    };
  }

  const manifest = options.manifest && Array.isArray(options.manifest.entries)
    ? options.manifest
    : await readMigrationManifest(root);
  manifest.startedAt = manifest.startedAt || nowIso();
  const journal = await readJournalFromSet(root);
  const summary = {
    locked: true,
    holder: null,
    moved: 0,
    skipped: 0,
    duplicate: 0,
    failed: 0,
    removedParents: manifest.removedParents || [],
    entries: [],
    manifest
  };
  const containersTouched = new Set();

  try {
    const total = plan.entries.filter((entry) => entry.action === "move").length;
    let processed = 0;

    for (const entry of plan.entries) {
      if (options.token && options.token.isCancellationRequested) {
        break;
      }
      const record = {
        from: entry.from,
        to: entry.to,
        identity: entry.identity,
        problemId: entry.problemId,
        action: entry.action,
        status: entry.action === "move" ? "pending" : "skipped",
        reason: entry.reason || null,
        at: nowIso()
      };

      if (entry.action !== "move") {
        if (entry.action === "duplicate") {
          summary.duplicate += 1;
        } else {
          summary.skipped += 1;
        }
        manifest.entries.push(record);
        summary.entries.push(record);
        continue;
      }

      containersTouched.add(entry.from.split("/")[0]);
      processed += 1;
      if (typeof options.onProgress === "function") {
        options.onProgress({ phase: "move", entry, processed, total });
      }

      const sourceDir = relativeToAbsolute(root, entry.from);
      let targetDir = relativeToAbsolute(root, entry.to);

      const sourceStat = await lstatSafe(sourceDir);
      if (!sourceStat) {
        // journal 说已完成、源也确实不在了 → 断点续跑时直接跳过
        if (journal.has(entry.from)) {
          record.status = "already-done";
          summary.moved += 1;
          summary.entries.push(record);
          continue;
        }
        record.status = "skipped";
        record.reason = "source-missing";
        summary.skipped += 1;
        manifest.entries.push(record);
        summary.entries.push(record);
        continue;
      }

      // 目标可能已被另一个身份占用（并发/手工改动）：重新分配
      const targetMetadata = await store.readProblemMetadata(targetDir);
      const targetStat = await lstatSafe(targetDir);
      const targetOccupied =
        Boolean(targetMetadata.metadata) ||
        (Boolean(targetStat) && (await store.directoryHasEntries(targetDir)));
      if (targetMetadata.metadata && targetMetadata.metadata.identity === entry.identity) {
        record.status = "skipped";
        record.reason = "target-exists";
        summary.duplicate += 1;
        manifest.entries.push(record);
        summary.entries.push(record);
        continue;
      }
      if (targetOccupied) {
        try {
          const resolved = await store.resolveProblemDir(
            root,
            { id: entry.problemId, display_id: entry.displayId, title: entry.title },
            null,
            { baseUrl: store.parseProblemIdentity(entry.identity).baseUrl }
          );
          targetDir = resolved.problemDir;
          record.to = store.toPosixRelative(root, targetDir);
        } catch (error) {
          record.status = "failed";
          record.reason = `resolve-failed: ${error.message}`;
          summary.failed += 1;
          manifest.entries.push(record);
          summary.entries.push(record);
          continue;
        }
      }

      try {
        const fingerprint = await computeFingerprint(sourceDir);
        const moveResult = await moveDirectory(sourceDir, targetDir);
        record.method = moveResult.method;
        record.fingerprint = fingerprint;
        record.status = "moved";
        record.at = nowIso();

        try {
          const metadata = await upgradeMigratedMetadata(root, entry, targetDir);
          record.identity = metadata.identity || entry.identity;
          await store.updateWorkspaceIndexEntries(root, [
            {
              identity: record.identity,
              entry: store.buildIndexEntry(store.toPosixRelative(root, targetDir), metadata),
              replace: true
            }
          ]);
          // 元数据升级后重新取指纹，供回滚判断“目标是否被用户改动”
          record.fingerprint = await computeFingerprint(targetDir);
        } catch (metadataError) {
          record.metadataError = metadataError && metadataError.message ? metadataError.message : String(metadataError);
        }

        summary.moved += 1;
      } catch (error) {
        record.status = "failed";
        record.reason = error && error.message ? error.message : String(error);
        if (error && error.requiresCleanup && error.targetDir) {
          record.requiresCleanup = store.toPosixRelative(root, error.targetDir);
        }
        summary.failed += 1;
      }

      manifest.entries.push(record);
      summary.entries.push(record);
      await appendJournal(root, record);
      await writeMigrationManifest(root, manifest);
    }

    if (!options.token || !options.token.isCancellationRequested) {
      manifest.completedAt = nowIso();
    }
    await cleanupEmptyLegacyParents(root, containersTouched, manifest.removedParents);
    summary.removedParents = manifest.removedParents;
    await writeMigrationManifest(root, manifest);
  } finally {
    await releaseMigrationLock(root);
  }

  return summary;
}

/**
 * 惰性迁移单道题（打开题目时兜底）。不迁移其他旧目录。
 * 返回 { moved, entry, problemDir } 或 null（该目录不在计划中）。
 */
async function migrateSingleProblem(rootPath, relativeDir, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const plan = await planMigration(root, options);
  const entry = plan.entries.find((item) => item.from === relativeDir);
  if (!entry) {
    return null;
  }
  if (entry.action !== "move") {
    return {
      moved: 0,
      entry,
      problemDir: entry.to ? relativeToAbsolute(root, entry.to) : null
    };
  }
  const result = await applyMigration(root, { entries: [entry], summary: {} }, options);
  const record = (result.entries && result.entries[0]) || entry;
  const targetRelative = record.to || entry.to;
  return {
    moved: result.moved,
    entry: record,
    problemDir: targetRelative ? relativeToAbsolute(root, targetRelative) : null
  };
}

/**
 * 一步到位：扫盘 → 计划 → 执行。供扩展激活/命令调用。
 */
async function ensureWorkspaceMigration(rootPath, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  if (!root) {
    return { skipped: true, reason: "no-root" };
  }
  const plan = await planMigration(root, options);
  if (!plan.entries.some((entry) => entry.action === "move")) {
    return Object.assign({ skipped: false, plan }, plan.summary);
  }
  const result = await applyMigration(root, plan, options);
  return Object.assign(result, { plan });
}

// ---------------------------------------------------------------------------
// 回滚
// ---------------------------------------------------------------------------

async function rollbackMigration(rootPath, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const manifest = options.manifest || (await readMigrationManifest(root));
  const lock = await acquireMigrationLock(root);
  if (!lock.acquired) {
    return { locked: false, holder: lock.holder, rolledBack: 0, skipped: 0, failed: [], manifest };
  }
  const summary = { locked: true, rolledBack: 0, skipped: 0, failed: [], manifest };
  const rolledBackFroms = new Set();
  try {
    const entries = manifest.entries.slice().reverse();
    for (const entry of entries) {
      if (options.token && options.token.isCancellationRequested) {
        break;
      }
      if (entry.status !== "moved" && entry.status !== "already-done") {
        continue;
      }
      if (!entry.to || !entry.from) {
        continue;
      }
      const fromDir = relativeToAbsolute(root, entry.from);
      const toDir = relativeToAbsolute(root, entry.to);
      const targetStat = await lstatSafe(toDir);
      if (!targetStat) {
        summary.skipped += 1;
        summary.failed.push({ from: entry.from, reason: "target-missing" });
        continue;
      }
      if (await store.pathExists(fromDir)) {
        summary.skipped += 1;
        summary.failed.push({ from: entry.from, reason: "source-exists" });
        continue;
      }
      if (entry.fingerprint) {
        try {
          const current = await computeFingerprint(toDir);
          if (
            current.fileCount !== entry.fingerprint.fileCount ||
            current.totalBytes !== entry.fingerprint.totalBytes
          ) {
            summary.skipped += 1;
            summary.failed.push({ from: entry.from, reason: "target-modified" });
            continue;
          }
        } catch (_error) {
          /* 指纹计算失败不阻断回滚 */
        }
      }
      try {
        await fs.mkdir(path.dirname(fromDir), { recursive: true });
        await moveDirectory(toDir, fromDir);
        await store.updateWorkspaceIndexEntries(root, [
          {
            identity: entry.identity,
            entry: {
              dir: entry.from,
              legacy: true,
              legacyFrom: entry.from
            }
          }
        ]);
        entry.status = "rolled-back";
        entry.rolledBackAt = nowIso();
        rolledBackFroms.add(entry.from);
        summary.rolledBack += 1;
        await writeMigrationManifest(root, manifest);
      } catch (error) {
        summary.failed.push({
          from: entry.from,
          reason: error && error.message ? error.message : String(error)
        });
      }
    }
    await rewriteJournalWithout(root, rolledBackFroms);
    await writeMigrationManifest(root, manifest);
  } finally {
    await releaseMigrationLock(root);
  }
  return summary;
}

module.exports = {
  LOCK_TTL_MS,
  acquireMigrationLock,
  releaseMigrationLock,
  readMigrationManifest,
  writeMigrationManifest,
  findLegacyProblemDirs,
  planMigration,
  applyMigration,
  ensureWorkspaceMigration,
  migrateSingleProblem,
  rollbackMigration,
  computeFingerprint,
  moveDirectory,
  copyTree,
  verifyCopy,
  listTree,
  readJournalFromSet
};
