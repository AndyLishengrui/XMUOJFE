/**
 * 共享进度与实验状态 helper。
 *
 * v0.1.0 起进度主键不再随根目录与实验上下文变化：
 *   <baseUrl>::<problemId>
 * 旧键（<baseUrl>::<contestId|problemset>::<problemId>::<绝对根目录>）在读取时
 * 回退兼容，并可一次性归并到新键；实验内进度额外镜像到 value.contests.<contestId>。
 *
 * 本模块不依赖 vscode，便于单测；extension.js 与 treeData.js 共用同一套实现。
 */
"use strict";

const PROGRESS_BACKUP_KEY = "xmuoj.problemProgress.v1";

function normalizeBaseUrlForKey(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function buildProblemProgressKey(baseUrl, problemId) {
  return `${normalizeBaseUrlForKey(baseUrl)}::${problemId}`;
}

/** 旧格式键（仅用于兼容读取与迁移测试）。 */
function buildLegacyProblemProgressKey(baseUrl, contestId, problemId, progressScope) {
  return [
    normalizeBaseUrlForKey(baseUrl),
    contestId || "problemset",
    problemId || "unknown",
    String(progressScope || "global")
  ].join("::");
}

function isLegacyProgressKey(key) {
  return String(key || "").split("::").length >= 4;
}

function parseProgressKey(key) {
  const parts = String(key || "").split("::");
  if (parts.length >= 4) {
    return {
      legacy: true,
      baseUrl: parts[0],
      contestId: parts[1] === "problemset" ? null : parts[1],
      problemId: parts[2],
      progressScope: parts.slice(3).join("::")
    };
  }
  return {
    legacy: false,
    baseUrl: parts[0] || "",
    contestId: null,
    problemId: parts[1] || null,
    progressScope: null
  };
}

function progressTimestamp(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  for (const field of ["updatedAt", "lastSubmissionAt", "lastLocalRunAt", "workspaceCreatedAt", "lastOpenedAt"]) {
    const parsed = Date.parse(value[field]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function newerOf(left, right) {
  return progressTimestamp(right) > progressTimestamp(left) ? right : left;
}

function mergeContestMaps(left, right) {
  const result = Object.assign({}, left || {});
  for (const [contestId, value] of Object.entries(right || {})) {
    result[contestId] = newerOf(result[contestId], value);
  }
  return result;
}

/** 合并两条同一题目的进度：字段取较新者，contests 子表求并集。 */
function mergeProgressValues(existing, incoming) {
  if (!existing) {
    return Object.assign({}, incoming || {});
  }
  if (!incoming) {
    return Object.assign({}, existing);
  }
  const newer = newerOf(existing, incoming);
  const older = newer === existing ? incoming : existing;
  return Object.assign({}, older, newer, {
    contests: mergeContestMaps(existing.contests, incoming.contests)
  });
}

/**
 * 把旧键批量归并到新键。纯函数：返回新对象，不修改入参。
 * { progress, changed, migratedKeys }
 */
function migrateProgressMap(progressMap) {
  const source = progressMap && typeof progressMap === "object" ? progressMap : {};
  const result = {};
  const migratedKeys = [];
  for (const [key, value] of Object.entries(source)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    if (!isLegacyProgressKey(key)) {
      result[key] = value;
      continue;
    }
    migratedKeys.push(key);
    const parsed = parseProgressKey(key);
    const newKey = buildProblemProgressKey(parsed.baseUrl, parsed.problemId);
    const contestId = parsed.contestId === "problemset" ? null : parsed.contestId;
    const incoming = Object.assign({}, value);
    if (contestId !== null && contestId !== undefined && contestId !== "") {
      incoming.contests = Object.assign({}, incoming.contests || {}, {
        [String(contestId)]: Object.assign({}, value)
      });
    }
    incoming.problemId = Number.isFinite(Number(parsed.problemId)) ? Number(parsed.problemId) : parsed.problemId;
    incoming.baseUrl = parsed.baseUrl;
    result[newKey] = mergeProgressValues(result[newKey], incoming);
  }
  return {
    progress: result,
    changed: migratedKeys.length > 0,
    migratedKeys
  };
}

/**
 * 读取一道题的进度（新键优先，旧键/全量扫描回退）。
 * ref: { baseUrl, problemId, contestId, progressScope }
 * 返回合并后的进度对象；无记录时 null。
 */
function resolveProblemProgress(progressMap, ref) {
  if (!progressMap || !ref || ref.problemId === undefined || ref.problemId === null) {
    return null;
  }
  const newKey = buildProblemProgressKey(ref.baseUrl, ref.problemId);
  let entry = progressMap[newKey] || null;
  if (!entry) {
    const legacyKey = buildLegacyProblemProgressKey(
      ref.baseUrl,
      ref.contestId,
      ref.problemId,
      ref.progressScope
    );
    entry = progressMap[legacyKey] || null;
  }
  if (!entry) {
    const baseUrl = normalizeBaseUrlForKey(ref.baseUrl);
    const prefix = `${baseUrl}::`;
    const suffix = `::${ref.problemId}::`;
    for (const [key, value] of Object.entries(progressMap)) {
      if (key.startsWith(prefix) && key.includes(suffix)) {
        const parsed = parseProgressKey(key);
        if (
          ref.contestId &&
          parsed.contestId !== null &&
          String(parsed.contestId) !== String(ref.contestId)
        ) {
          continue;
        }
        entry = entry ? newerOf(entry, value) : value;
      }
    }
  }
  if (!entry) {
    return null;
  }
  const scoped = ref.contestId && entry.contests ? entry.contests[String(ref.contestId)] : null;
  return scoped ? Object.assign({}, entry, scoped, { contests: entry.contests }) : Object.assign({}, entry);
}

function getProblemProgressSummary(progress) {
  if (!progress) {
    return "未开始";
  }
  if (progress.accepted) {
    return "已 AC";
  }
  if (progress.lastSubmissionLabel) {
    return `已提交 · ${progress.lastSubmissionLabel}`;
  }
  if (progress.localPassed) {
    return "本地通过";
  }
  if (progress.workspaceCreated) {
    return "已开题";
  }
  return "未开始";
}

/**
 * 生成更新后的进度表（纯函数）。实验上下文会镜像到 contests.<contestId>。
 * 返回 { progress, entry }。
 */
function applyProgressPatch(progressMap, ref, patch, timestamp) {
  const now = timestamp || new Date().toISOString();
  const source = progressMap && typeof progressMap === "object" ? progressMap : {};
  const key = ref && ref.key ? ref.key : buildProblemProgressKey(ref && ref.baseUrl, ref && ref.problemId);
  const current = source[key] || {};
  const next = Object.assign({}, current, {
    baseUrl: ref.baseUrl,
    problemId: ref.problemId,
    displayId: ref.displayId || current.displayId,
    title: ref.title || current.title,
    updatedAt: now
  }, patch);
  if (ref.contestId) {
    next.contests = Object.assign({}, current.contests || {}, {
      [String(ref.contestId)]: Object.assign({}, current.contests && current.contests[String(ref.contestId)], {
        contestId: ref.contestId,
        contestTitle: ref.contestTitle || null,
        updatedAt: now
      }, patch)
    });
  }
  const progress = Object.assign({}, source, { [key]: next });
  return { progress, entry: next };
}

// ---------------------------------------------------------------------------
// 实验状态
// ---------------------------------------------------------------------------

function readContestStatus(contest) {
  if (!contest || contest.status === undefined || contest.status === null) {
    return "";
  }
  return contest.status;
}

function normalizeContestStatus(status) {
  const raw = status === undefined || status === null ? "" : String(status).trim();
  const lower = raw.toLowerCase();
  if (raw === "-1") {
    return { key: "ended", label: "结束" };
  }
  if (raw === "0") {
    return { key: "running", label: "进行中" };
  }
  if (raw === "1") {
    return { key: "pending", label: "准备中" };
  }
  if (["ended", "end", "finished", "closed", "over"].includes(lower)) {
    return { key: "ended", label: "结束" };
  }
  if (["pending", "preparing", "scheduled", "not_started", "not-started"].includes(lower)) {
    return { key: "pending", label: "准备中" };
  }
  if (["running", "active", "started", "ongoing", "live"].includes(lower)) {
    return { key: "running", label: "进行中" };
  }
  if (["结束", "已结束"].includes(raw)) {
    return { key: "ended", label: "结束" };
  }
  if (["准备中", "未开始"].includes(raw)) {
    return { key: "pending", label: "准备中" };
  }
  if (["进行中", "已开始"].includes(raw)) {
    return { key: "running", label: "进行中" };
  }
  return { key: raw ? lower : "unknown", label: raw || "未知" };
}

function getContestStatusLabel(contest) {
  return normalizeContestStatus(readContestStatus(contest)).label;
}

function canContestSubmitRemotely(contest) {
  return normalizeContestStatus(readContestStatus(contest)).key === "running";
}

function buildContestSubmitBlockedMessage(contest) {
  const status = normalizeContestStatus(readContestStatus(contest));
  if (status.key === "ended") {
    return "该实验已结束，不能远程提交，只能本地测评。请使用“运行本地测试”。";
  }
  if (status.key === "pending") {
    return "该实验处于准备中，不能远程提交。请等待实验开始后再提交，或先使用“运行本地测试”。";
  }
  return `该实验当前状态为“${status.label}”，仅“进行中”的实验允许远程提交。请先使用“运行本地测试”。`;
}

module.exports = {
  PROGRESS_BACKUP_KEY,
  normalizeBaseUrlForKey,
  buildProblemProgressKey,
  buildLegacyProblemProgressKey,
  isLegacyProgressKey,
  parseProgressKey,
  mergeProgressValues,
  migrateProgressMap,
  resolveProblemProgress,
  getProblemProgressSummary,
  applyProgressPatch,
  normalizeContestStatus,
  getContestStatusLabel,
  canContestSubmitRemotely,
  buildContestSubmitBlockedMessage
};
