/**
 * 时间胶囊题库索引：把全局胶囊列表按题目聚合，计算尝试序号与对比目标。
 *
 * 胶囊本身仍是独立的 gzip 文件，不引入数据库；这里只做纯函数派生，
 * 因此删除/导入胶囊后索引会自然重算，不会出现第二份需要同步的权威数据。
 */
"use strict";

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== "") {
      return value;
    }
  }
  return "";
}

/**
 * 题目身份键：数字题目 id 优先，其次展示号。
 * 与工作区元数据使用同一套口径，避免公共题库与实验题被拆成两组。
 */
function problemKeyOf(problem) {
  if (!problem || typeof problem !== "object") {
    return "";
  }
  const id = firstValue(problem.id, problem.problemId);
  if (id !== "") {
    return `id:${String(id)}`;
  }
  const displayId = firstValue(problem.displayId, problem.display_id);
  if (displayId !== "") {
    return `display:${String(displayId).trim().toLowerCase()}`;
  }
  return "";
}

function entryProblemKey(entry) {
  if (!entry || typeof entry !== "object") {
    return "";
  }
  if (entry.problemKey) {
    return String(entry.problemKey);
  }
  return problemKeyOf(entry.problem);
}

function startedAtMs(entry) {
  const value = Date.parse(String((entry && entry.startedAt) || ""));
  return Number.isFinite(value) ? value : 0;
}

function displayIdOf(problem) {
  return String(firstValue(
    problem && problem.displayId,
    problem && problem.display_id
  )).trim().toLowerCase();
}

function entryHasNumericId(entry) {
  const problem = entry && entry.problem;
  return Boolean(problem) && firstValue(problem.id, problem.problemId) !== "";
}

/**
 * 同一道题的判定：
 * - 归一化键相同；
 * - 或者旧胶囊只有展示号、没有数字 id 时，用展示号兜底。
 * 数字 id 双方都存在时绝不按展示号合并，避免跨实验重名串组。
 */
function sameProblem(entry, key, displayId) {
  if (entryProblemKey(entry) === key) {
    return true;
  }
  if (!displayId || entryHasNumericId(entry)) {
    return false;
  }
  return displayIdOf(entry && entry.problem) === displayId;
}

function compareAttemptsAscending(left, right) {
  return (
    startedAtMs(left) - startedAtMs(right) ||
    String((left && left.id) || "").localeCompare(String((right && right.id) || ""))
  );
}

/**
 * 按题目筛选并标注尝试序号。
 * 返回按开始时间倒序（最新在前）的数组，适合回放页的“尝试”列表。
 */
function attemptsForProblem(entries, problem) {
  const key = problemKeyOf(problem);
  if (!key) {
    return [];
  }
  const displayId = displayIdOf(problem);
  const matching = (Array.isArray(entries) ? entries : [])
    .filter((entry) => sameProblem(entry, key, displayId))
    .slice()
    .sort(compareAttemptsAscending);
  return matching
    .map((entry, index) => Object.assign({}, entry, {
      attemptNumber: Number(entry.attempt) > 0 ? Number(entry.attempt) : index + 1
    }))
    .reverse();
}

/** 选择与当前尝试对比的另一条：优先更早一次，其次更新一次。 */
function compareTarget(attempts, currentId) {
  const list = Array.isArray(attempts) ? attempts : [];
  const index = list.findIndex((entry) => String(entry.id) === String(currentId));
  if (index < 0 || list.length < 2) {
    return null;
  }
  return list[index + 1] || list[index - 1] || null;
}

/** 胶囊最终代码：最后一个检查点；录制器停止时一定会补一个。 */
function finalTextOf(capsule) {
  const events = capsule && Array.isArray(capsule.events) ? capsule.events : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i] && events[i].k === "cp") {
      return String(events[i].text || "");
    }
  }
  return "";
}

function attemptLabel(entry) {
  const attempt = Number(entry && (entry.attemptNumber || entry.attempt));
  return Number.isFinite(attempt) && attempt > 0 ? `第 ${attempt} 次` : "一次尝试";
}

module.exports = {
  problemKeyOf,
  entryProblemKey,
  attemptsForProblem,
  compareTarget,
  finalTextOf,
  attemptLabel,
  compareAttemptsAscending
};
