/**
 * XMUOJ 本地存储核心（v0.1.0 统一布局）
 *
 * 目录约定：
 *   {root}/problems/<displayId>-<标题>/    一道题一个目录，竞赛题与公共题不再分家
 *   {root}/.xmuoj/index.json                身份 → 目录索引（派生缓存，可重建）
 *   {root}/.xmuoj/migration.json            迁移清单（回滚依据，由 migration.js 维护）
 *
 * 身份键：<baseUrl>::<problemId>。problemId 是数据库主键，同一道题无论从
 * 公共题库还是实验进入都收敛到同一个目录；实验信息只存在元数据里。
 *
 * 本模块不依赖 vscode，纯 Node，便于单测。
 */
"use strict";

const fs = require("fs/promises");
const path = require("path");

const METADATA_FILE_NAME = ".xmuoj.json";
const PROBLEMS_DIR_NAME = "problems";
const META_DIR_NAME = ".xmuoj";
const INDEX_FILE_NAME = "index.json";
const MIGRATION_FILE_NAME = "migration.json";
const MIGRATION_LOG_FILE_NAME = "migration.log.jsonl";
const MIGRATION_LOCK_FILE_NAME = "migration.lock";
const BACKUP_V1_DIR_NAME = "backup-v1";
const LEGACY_PROBLEMSET_DIR_NAME = "problemsets";
const LEGACY_CONTEST_DIR_RE = /^contest-\d+$/i;

const INDEX_VERSION = 1;
const METADATA_VERSION = 2;

const SOURCE_FILE_NAMES = {
  C: "main.c",
  "C++": "main.cpp",
  Java: "Main.java",
  Python3: "main.py"
};

const MAX_DIR_NAME_LENGTH = 60;
const MAX_COLLISION_ATTEMPTS = 200;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const ILLEGAL_SEGMENT_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim();
  return value.replace(/\/+$/, "");
}

function readProblemId(problem) {
  if (!problem || typeof problem !== "object") {
    return null;
  }
  const value = problem.id !== undefined && problem.id !== null ? problem.id : problem.problemId;
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function readDisplayId(problem) {
  return String((problem && (problem.display_id || problem.displayId || problem._id)) || "").trim();
}

function buildProblemIdentity(baseUrl, problemId) {
  const normalized = normalizeBaseUrl(baseUrl);
  return `${normalized}::${problemId}`;
}

function parseProblemIdentity(identity) {
  const value = String(identity || "");
  const index = value.lastIndexOf("::");
  if (index < 0) {
    return { baseUrl: "", problemId: null };
  }
  const problemIdText = value.slice(index + 2);
  const numeric = Number(problemIdText);
  return {
    baseUrl: value.slice(0, index),
    problemId: Number.isFinite(numeric) ? numeric : problemIdText
  };
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toPosixRelative(fromRoot, targetPath) {
  return path.relative(fromRoot, targetPath).split(path.sep).join("/");
}

/** 原子写：临时文件 + rename。失败时清理临时文件，绝不留下半截 JSON。 */
let temporaryFileCounter = 0;
async function atomicWriteFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${(temporaryFileCounter += 1)}-${Date.now()}`;
  await fs.writeFile(tempPath, content, "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch (_cleanupError) {
      /* ignore */
    }
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, JSON.stringify(value, null, 2) + "\n");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readDirSafe(targetPath) {
  try {
    return await fs.readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listSubdirectories(targetPath) {
  const entries = await readDirSafe(targetPath);
  return entries
    .filter((entry) => entry && entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

/** 目录里是否有任何内容（包括隐藏文件，但忽略 .DS_Store）。 */
async function directoryHasEntries(targetPath) {
  const entries = await readDirSafe(targetPath);
  return entries.some((entry) => entry && entry.name !== ".DS_Store");
}

// ---------------------------------------------------------------------------
// 目录命名
// ---------------------------------------------------------------------------

/**
 * 保留 Unicode（中文/字母/数字），只把文件系统非法字符、控制字符和连续空白
 * 替换为 `-`；去首尾 `-` 与 `.`。空标题回退为 `problem`。
 */
function slugifyTitle(title) {
  let value = String(title === undefined || title === null ? "" : title);
  value = value
    .replace(ILLEGAL_SEGMENT_CHARS, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return value || "problem";
}

function truncateSegment(value, maxLength) {
  const chars = Array.from(String(value || ""));
  if (chars.length <= maxLength) {
    return String(value || "");
  }
  const clipped = chars
    .slice(0, maxLength)
    .join("")
    .replace(/[-.]+$/g, "");
  return clipped || "problem";
}

function sanitizeSegment(value, fallback) {
  const slug = slugifyTitle(value);
  return slug === "problem" && !String(value || "").trim() ? fallback || "problem" : slug;
}

function applyWindowsReservedName(name) {
  return WINDOWS_RESERVED_NAMES.test(name) ? `_${name}` : name;
}

/**
 * `<displayId>-<标题片段>`，最多 60 个字符（按码点截断）。
 * displayId 先做安全处理（个别展示号可能含 `/`）。
 */
function buildProblemDirName(problem) {
  const displayId = sanitizeSegment(readDisplayId(problem), "problem");
  const titleSlug = slugifyTitle(problem && problem.title);
  const raw = truncateSegment(`${displayId}-${titleSlug}`, MAX_DIR_NAME_LENGTH);
  return applyWindowsReservedName(raw);
}

function withProblemSuffix(baseName, attempt, problemId) {
  if (attempt === 1) {
    return truncateSegment(`${baseName}-p${problemId}`, MAX_DIR_NAME_LENGTH + 12);
  }
  return truncateSegment(`${baseName}-${attempt}`, MAX_DIR_NAME_LENGTH + 8);
}

// ---------------------------------------------------------------------------
// 元数据 v2
// ---------------------------------------------------------------------------

function coerceSourceFiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const [language, fileName] of Object.entries(value)) {
    if (typeof fileName === "string" && fileName.trim()) {
      result[language] = fileName;
    }
  }
  return result;
}

/**
 * 把任意版本（v1/v2/手工修改）的元数据规范化为 v2。
 * 未知字段会被保留，避免历史字段在升级时丢失。
 */
function normalizeProblemMetadata(raw, options = {}) {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const baseUrl = normalizeBaseUrl(input.baseUrl || options.baseUrl || "");
  const problemId = input.problemId !== undefined && input.problemId !== null
    ? input.problemId
    : options.problemId;
  const sourceFiles = coerceSourceFiles(input.sourceFiles);
  const language = typeof input.language === "string" && input.language ? input.language : null;
  const sourceFile = typeof input.sourceFile === "string" && input.sourceFile
    ? input.sourceFile
    : (language ? sourceFiles[language] || SOURCE_FILE_NAMES[language] || null : null);
  if (language && sourceFile && !sourceFiles[language]) {
    sourceFiles[language] = sourceFile;
  }
  const status = input.status === "active" || input.status === "placeholder"
    ? input.status
    : (language && sourceFile ? "active" : "placeholder");
  const identity = input.identity || (problemId !== undefined && problemId !== null
    ? buildProblemIdentity(baseUrl, problemId)
    : "");

  return Object.assign({}, input, {
    version: METADATA_VERSION,
    identity,
    baseUrl,
    problemId: problemId === undefined ? null : problemId,
    contestId: input.contestId === undefined ? null : input.contestId,
    contestTitle: input.contestTitle === undefined ? null : input.contestTitle,
    displayId: input.displayId || input.display_id || "",
    title: input.title || "",
    language,
    sourceFile,
    sourceFiles,
    status,
    createdAt: input.createdAt || options.now || null,
    updatedAt: input.updatedAt || input.createdAt || options.now || null,
    lastOpenedAt: input.lastOpenedAt || null
  });
}

function resolveMetadataPath(target) {
  const value = String(target || "");
  return value.endsWith(METADATA_FILE_NAME) ? value : path.join(value, METADATA_FILE_NAME);
}

/**
 * 读取目录（或元数据文件路径）下的 .xmuoj.json。
 * 缺失/损坏都不抛异常：返回 { metadata: null, error, corrupt }，由调用方决定如何处理。
 */
async function readProblemMetadata(target, options = {}) {
  const metadataPath = resolveMetadataPath(target);
  let rawText;
  try {
    rawText = await fs.readFile(metadataPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { metadata: null, raw: null, metadataPath, exists: false, corrupt: false, error: null };
    }
    return {
      metadata: null,
      raw: null,
      metadataPath,
      exists: true,
      corrupt: true,
      error: error && error.message ? error.message : String(error)
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return {
      metadata: null,
      raw: null,
      metadataPath,
      exists: true,
      corrupt: true,
      error: error && error.message ? error.message : String(error)
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      metadata: null,
      raw: null,
      metadataPath,
      exists: true,
      corrupt: true,
      error: "元数据不是对象"
    };
  }
  return {
    metadata: normalizeProblemMetadata(parsed, { baseUrl: options.baseUrl, problemId: options.problemId }),
    raw: parsed,
    metadataPath,
    exists: true,
    corrupt: false,
    error: null
  };
}

/**
 * 合并写入 v2 元数据：读旧文件 → 合并 patch → 原子写。
 * 绝不重置 sourceFiles / createdAt（patch 可显式覆盖单个字段）。
 * 返回合并后的元数据对象。
 */
async function writeProblemMetadata(problemDir, patch, options = {}) {
  const metadataPath = path.join(problemDir, METADATA_FILE_NAME);
  const existing = await readProblemMetadata(metadataPath, { baseUrl: options.baseUrl, problemId: options.problemId });
  const previous = existing.raw || {};
  const incoming = patch && typeof patch === "object" ? patch : {};
  const merged = Object.assign({}, previous, incoming);
  if (incoming.sourceFiles) {
    merged.sourceFiles = Object.assign({}, coerceSourceFiles(previous.sourceFiles), coerceSourceFiles(incoming.sourceFiles));
  }
  const metadata = normalizeProblemMetadata(merged, {
    baseUrl: options.baseUrl || previous.baseUrl,
    problemId: options.problemId !== undefined ? options.problemId : previous.problemId,
    now: nowIso()
  });
  metadata.updatedAt = nowIso();
  await atomicWriteJson(metadataPath, metadata);
  return metadata;
}

function isMetadataActive(metadata) {
  return Boolean(metadata && metadata.status === "active");
}

// ---------------------------------------------------------------------------
// 新布局：解析题目目录（含冲突处理）
// ---------------------------------------------------------------------------

/**
 * 找到（或分配）一道题在 {root}/problems 下的目录。
 *  - 索引里已有且目录元数据身份一致 → 复用；
 *  - 目标目录不存在或为空 → 使用；
 *  - 目标目录属于另一个身份 → 依次尝试 `<base>-p<problemId>`、`<base>-2`……
 * 不移动任何目录；旧布局条目不参与（迁移由 migration.js 负责）。
 *
 * options: { baseUrl, index, includeLegacy }
 * 返回 { problemDir, identity, dirName, reused }
 */
async function resolveProblemDir(rootPath, problem, contest, options = {}) {
  void contest;
  const root = path.resolve(String(rootPath || ""));
  const problemId = readProblemId(problem);
  if (problemId === null) {
    throw new Error("无法解析题目 id，不能分配本地目录");
  }
  const identity = buildProblemIdentity(options.baseUrl, problemId);
  const problemsRoot = path.join(root, PROBLEMS_DIR_NAME);
  const index = options.index || (await readWorkspaceIndex(root));

  const indexed = findIndexEntry(index, identity);
  if (indexed && indexed.dir && (!indexed.legacy || options.includeLegacy)) {
    const indexedDir = path.join(root, indexed.dir);
    const existing = await readProblemMetadata(indexedDir);
    if (existing.metadata && existing.metadata.identity === identity) {
      return {
        problemDir: indexedDir,
        identity,
        dirName: path.basename(indexedDir),
        reused: true
      };
    }
  }

  const baseName = buildProblemDirName(problem);
  let candidateName = baseName;
  for (let attempt = 0; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      candidateName = applyWindowsReservedName(withProblemSuffix(baseName, attempt, problemId));
    }
    const candidateDir = path.join(problemsRoot, candidateName);
    const existing = await readProblemMetadata(candidateDir);
    if (!existing.exists && !(await pathExists(candidateDir))) {
      return { problemDir: candidateDir, identity, dirName: candidateName, reused: false };
    }
    if (existing.metadata && existing.metadata.identity === identity) {
      return { problemDir: candidateDir, identity, dirName: candidateName, reused: true };
    }
    if (!existing.exists && !(await directoryHasEntries(candidateDir))) {
      // 空目录：可以安全占用
      return { problemDir: candidateDir, identity, dirName: candidateName, reused: false };
    }
  }
  throw new Error(`无法为 ${identity} 分配目录：${baseName} 的冲突过多`);
}

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

function createEmptyIndex(baseUrl) {
  return {
    version: INDEX_VERSION,
    baseUrl: normalizeBaseUrl(baseUrl),
    updatedAt: null,
    problemsMtimeMs: 0,
    entries: {}
  };
}

function isUsableIndex(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.version === INDEX_VERSION &&
    value.entries &&
    typeof value.entries === "object" &&
    !Array.isArray(value.entries)
  );
}

async function readWorkspaceIndex(rootPath) {
  const root = path.resolve(String(rootPath || ""));
  const indexPath = path.join(root, META_DIR_NAME, INDEX_FILE_NAME);
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (!isUsableIndex(parsed)) {
      return Object.assign(createEmptyIndex(parsed && parsed.baseUrl), { corrupt: true, indexPath });
    }
    return Object.assign(createEmptyIndex(parsed.baseUrl), parsed, { corrupt: false, indexPath });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return Object.assign(createEmptyIndex(), { corrupt: false, indexPath });
    }
    return Object.assign(createEmptyIndex(), { corrupt: true, indexPath });
  }
}

async function writeWorkspaceIndex(rootPath, index) {
  const root = path.resolve(String(rootPath || ""));
  const indexPath = path.join(root, META_DIR_NAME, INDEX_FILE_NAME);
  const next = Object.assign(createEmptyIndex(index && index.baseUrl), index, {
    version: INDEX_VERSION,
    updatedAt: nowIso()
  });
  await atomicWriteJson(indexPath, next);
  return next;
}

// 同一进程内串行化索引写入，避免并发“读-改-写”丢更新
let indexWriteQueue = Promise.resolve();
function withIndexWriteLock(task) {
  const run = indexWriteQueue.then(task, task);
  indexWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function buildIndexEntry(dirRelative, metadata, extras = {}) {
  return Object.assign(
    {
      dir: dirRelative,
      identity: metadata.identity,
      problemId: metadata.problemId,
      displayId: metadata.displayId || "",
      title: metadata.title || "",
      contestId: metadata.contestId === undefined ? null : metadata.contestId,
      contestTitle: metadata.contestTitle === undefined ? null : metadata.contestTitle,
      language: metadata.language || null,
      status: metadata.status || "placeholder",
      updatedAt: metadata.updatedAt || metadata.createdAt || null
    },
    extras
  );
}

/**
 * 读-改-写索引。upserts: [{ identity, entry }]；removeIdentities: string[]。
 * 条目 entry.dir 必须是相对根目录的 POSIX 路径。
 */
async function updateWorkspaceIndexEntries(rootPath, upserts, removeIdentities) {
  const root = path.resolve(String(rootPath || ""));
  return withIndexWriteLock(async () => {
    const index = await readWorkspaceIndex(root);
    for (const identity of removeIdentities || []) {
      delete index.entries[identity];
    }
    for (const item of upserts || []) {
      if (item && item.identity && item.entry) {
        index.entries[item.identity] = item.replace
          ? Object.assign({}, item.entry)
          : Object.assign({}, index.entries[item.identity] || {}, item.entry);
      }
    }
    const next = Object.assign({}, index, {
      version: INDEX_VERSION,
      updatedAt: nowIso()
    });
    await atomicWriteJson(path.join(root, META_DIR_NAME, INDEX_FILE_NAME), next);
    return next;
  });
}

function findIndexEntry(index, identity) {
  if (!index || !index.entries) {
    return null;
  }
  return index.entries[identity] || null;
}

function getIndexEntries(index) {
  if (!index || !index.entries) {
    return [];
  }
  return Object.values(index.entries).filter((entry) => entry && entry.dir && entry.problemId !== undefined && entry.problemId !== null);
}

/** 按 contestId 分组；contestId 为 null 的归入公共题库组。 */
function groupIndexEntriesByContest(index) {
  const groups = new Map();
  for (const entry of getIndexEntries(index)) {
    const key = entry.contestId === undefined || entry.contestId === null ? "public" : String(entry.contestId);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        contestId: entry.contestId === undefined ? null : entry.contestId,
        contestTitle: entry.contestTitle || null,
        entries: []
      });
    }
    groups.get(key).entries.push(entry);
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// 目录扫描（启动扫盘，只读）
// ---------------------------------------------------------------------------

async function getProblemsDirMtimeMs(rootPath) {
  try {
    const stat = await fs.stat(path.join(rootPath, PROBLEMS_DIR_NAME));
    return stat.mtimeMs;
  } catch (_error) {
    return 0;
  }
}

async function scanDirectoryForMetadata(root, absoluteDir, subdirName, options) {
  const dir = path.join(absoluteDir, subdirName);
  const result = await readProblemMetadata(dir, options);
  if (!result.metadata) {
    return { dir, metadata: null, skipped: true, reason: result.corrupt ? "corrupt-metadata" : "no-metadata" };
  }
  if (result.metadata.problemId === null || result.metadata.problemId === undefined) {
    return { dir, metadata: null, skipped: true, reason: "no-problem-id" };
  }
  return { dir, metadata: result.metadata, skipped: false };
}

/**
 * 只读扫描工作区：
 *  - problems/ 下的一层题目目录；
 *  - 尚未迁移的 contest-<id>/<题>/ 与 problemsets/<题>/。
 * 不移动、不写盘。返回 { index, legacy, problemsMtimeMs, unreadable }。
 */
async function scanWorkspace(rootPath, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const index = createEmptyIndex(baseUrl);
  const legacy = [];
  const unreadable = [];
  const problemsRoot = path.join(root, PROBLEMS_DIR_NAME);

  for (const name of await listSubdirectories(problemsRoot)) {
    const absoluteDir = path.join(problemsRoot, name);
    const found = await scanDirectoryForMetadata(root, problemsRoot, name, { baseUrl });
    if (found.skipped) {
      if (found.reason === "corrupt-metadata") {
        unreadable.push({ dir: toPosixRelative(root, absoluteDir), reason: found.reason });
      }
      continue;
    }
    const metadata = found.metadata;
    index.entries[metadata.identity] = buildIndexEntry(toPosixRelative(root, absoluteDir), metadata);
  }

  const legacyRoots = [];
  for (const name of await listSubdirectories(root)) {
    if (LEGACY_CONTEST_DIR_RE.test(name) || name === LEGACY_PROBLEMSET_DIR_NAME) {
      legacyRoots.push(name);
    }
  }
  for (const containerName of legacyRoots) {
    const containerDir = path.join(root, containerName);
    const isContest = LEGACY_CONTEST_DIR_RE.test(containerName);
    for (const name of await listSubdirectories(containerDir)) {
      const absoluteDir = path.join(containerDir, name);
      const found = await scanDirectoryForMetadata(root, containerDir, name, { baseUrl });
      if (found.skipped) {
        if (found.reason === "corrupt-metadata") {
          unreadable.push({ dir: toPosixRelative(root, absoluteDir), reason: found.reason });
        }
        continue;
      }
      const metadata = found.metadata;
      const relativeDir = toPosixRelative(root, absoluteDir);
      legacy.push({
        dir: relativeDir,
        identity: metadata.identity,
        metadata,
        container: containerName,
        contestId: isContest ? Number(containerName.slice("contest-".length)) : metadata.contestId
      });
      if (!index.entries[metadata.identity]) {
        index.entries[metadata.identity] = buildIndexEntry(relativeDir, metadata, {
          legacy: true,
          legacyFrom: relativeDir
        });
      }
    }
  }

  index.problemsMtimeMs = await getProblemsDirMtimeMs(root);
  index.updatedAt = nowIso();
  return { index, legacy, unreadable, problemsMtimeMs: index.problemsMtimeMs };
}

/**
 * 保证索引可用：索引有效且 problems/ 的 mtime 未变时直接复用，
 * 否则扫描重建并写盘。返回 { index, legacy, unreadable, scanned }。
 */
async function ensureWorkspaceIndex(rootPath, options = {}) {
  const root = path.resolve(String(rootPath || ""));
  const force = Boolean(options.force);
  const problemsMtimeMs = await getProblemsDirMtimeMs(root);
  if (!force) {
    const existing = await readWorkspaceIndex(root);
    if (
      !existing.corrupt &&
      existing.updatedAt &&
      existing.problemsMtimeMs === problemsMtimeMs &&
      (!options.baseUrl || !existing.baseUrl || existing.baseUrl === normalizeBaseUrl(options.baseUrl))
    ) {
      return { index: existing, legacy: [], unreadable: [], scanned: false };
    }
  }
  const scanned = await scanWorkspace(root, options);
  const written = await writeWorkspaceIndex(root, scanned.index);
  return {
    index: written,
    legacy: scanned.legacy,
    unreadable: scanned.unreadable,
    scanned: true
  };
}

// ---------------------------------------------------------------------------
// 旧布局识别与根目录规范化
// ---------------------------------------------------------------------------

/** 目录是否位于旧布局容器内；返回 { type, contestId, container } 或 null。 */
function getLegacyContainer(rootPath, absoluteDir) {
  const root = path.resolve(String(rootPath || ""));
  const relative = path.relative(root, absoluteDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  const parts = relative.split(path.sep);
  if (parts.length < 2) {
    return null;
  }
  const container = parts[0];
  if (LEGACY_CONTEST_DIR_RE.test(container)) {
    return {
      type: "contest",
      contestId: Number(container.slice("contest-".length)),
      container
    };
  }
  if (container === LEGACY_PROBLEMSET_DIR_NAME) {
    return { type: "problemset", contestId: null, container };
  }
  return null;
}

function normalizeWorkspaceRootPath(inputPath) {
  const value = String(inputPath || "").trim();
  if (!value) {
    return "";
  }
  const resolved = path.resolve(value);
  const baseName = path.basename(resolved);
  const parent = path.dirname(resolved);
  const parentBaseName = path.basename(parent);

  const isContainerName = (name) =>
    name === PROBLEMS_DIR_NAME ||
    name === LEGACY_PROBLEMSET_DIR_NAME ||
    name === META_DIR_NAME ||
    LEGACY_CONTEST_DIR_RE.test(name);

  if (isContainerName(baseName)) {
    return parent;
  }
  if (isContainerName(parentBaseName)) {
    return path.dirname(parent);
  }
  return resolved;
}

function buildWorkspaceRootNormalizationMessage(selectedPath, normalizedPath) {
  const selectedResolved = path.resolve(String(selectedPath || ""));
  const normalizedResolved = path.resolve(String(normalizedPath || ""));
  if (!selectedResolved || selectedResolved === normalizedResolved) {
    return "";
  }
  const baseName = path.basename(selectedResolved);
  const parentBaseName = path.basename(path.dirname(selectedResolved));

  if (baseName === PROBLEMS_DIR_NAME) {
    return `你选择的是题目目录「${selectedResolved}」，已自动回退为工作区根目录：${normalizedResolved}`;
  }
  if (baseName === LEGACY_PROBLEMSET_DIR_NAME) {
    return `你选择的是旧版公共题库目录「${selectedResolved}」，已自动回退为工作区根目录：${normalizedResolved}`;
  }
  if (LEGACY_CONTEST_DIR_RE.test(baseName)) {
    return `你选择的是实验目录「${selectedResolved}」，已自动回退为工作区根目录：${normalizedResolved}`;
  }
  if (parentBaseName === PROBLEMS_DIR_NAME) {
    return `你选择的是单题目录「${selectedResolved}」，已自动回退为工作区根目录：${normalizedResolved}`;
  }
  if (parentBaseName === LEGACY_PROBLEMSET_DIR_NAME || LEGACY_CONTEST_DIR_RE.test(parentBaseName)) {
    return `你选择的是单题目录「${selectedResolved}」，已自动回退为工作区根目录：${normalizedResolved}`;
  }
  return `已自动规范目录为工作区根目录：${normalizedResolved}`;
}

module.exports = {
  // 常量
  METADATA_FILE_NAME,
  PROBLEMS_DIR_NAME,
  META_DIR_NAME,
  INDEX_FILE_NAME,
  MIGRATION_FILE_NAME,
  MIGRATION_LOG_FILE_NAME,
  MIGRATION_LOCK_FILE_NAME,
  BACKUP_V1_DIR_NAME,
  LEGACY_PROBLEMSET_DIR_NAME,
  LEGACY_CONTEST_DIR_RE,
  INDEX_VERSION,
  METADATA_VERSION,
  SOURCE_FILE_NAMES,
  // 基础工具
  normalizeBaseUrl,
  buildProblemIdentity,
  parseProblemIdentity,
  readProblemId,
  readDisplayId,
  isPathInside,
  toPosixRelative,
  atomicWriteFile,
  atomicWriteJson,
  pathExists,
  directoryHasEntries,
  // 命名
  slugifyTitle,
  buildProblemDirName,
  resolveProblemDir,
  // 元数据
  normalizeProblemMetadata,
  readProblemMetadata,
  writeProblemMetadata,
  isMetadataActive,
  // 索引
  createEmptyIndex,
  readWorkspaceIndex,
  writeWorkspaceIndex,
  updateWorkspaceIndexEntries,
  findIndexEntry,
  getIndexEntries,
  groupIndexEntriesByContest,
  buildIndexEntry,
  scanWorkspace,
  ensureWorkspaceIndex,
  // 旧布局 / 根目录
  getLegacyContainer,
  normalizeWorkspaceRootPath,
  buildWorkspaceRootNormalizationMessage
};
