/**
 * 题库目录的合并、分类、筛选、排序与统计。纯函数，不依赖 vscode。
 */
"use strict";

const DIFFICULTY_ORDER = Object.freeze({ Low: 0, Mid: 1, High: 2 });

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function progressEntryAttempted(entry) {
  return Boolean(
    entry &&
      (entry.accepted ||
        entry.localPassed ||
        entry.lastSubmissionLabel ||
        entry.workspaceCreated)
  );
}

/**
 * 把 globalState 的进度表建成 id/displayId 两套索引。
 * 进度键格式：<baseUrl>::<problemId>。
 */
function buildLocalProgressIndex(progressMap, baseUrl) {
  const byId = new Map();
  const byDisplayId = new Map();
  const prefix = `${normalizeBaseUrl(baseUrl)}::`;
  const source = progressMap && typeof progressMap === "object" ? progressMap : {};
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== "object" || !key.startsWith(prefix)) {
      continue;
    }
    const keyId = key.slice(prefix.length);
    const identifiers = [keyId, entry.problemId]
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map(String);
    for (const identifier of identifiers) {
      if (!byId.has(identifier)) {
        byId.set(identifier, entry);
      }
    }
    if (entry.displayId) {
      byDisplayId.set(String(entry.displayId), entry);
    }
  }
  return { byId, byDisplayId };
}

function findLocalProgress(localIndex, problem) {
  if (!localIndex || !problem) {
    return null;
  }
  const idKey = String(problem.id);
  if (localIndex.byId.has(idKey)) {
    return localIndex.byId.get(idKey);
  }
  if (problem.displayId && localIndex.byDisplayId.has(String(problem.displayId))) {
    return localIndex.byDisplayId.get(String(problem.displayId));
  }
  return null;
}

function normalizeLocal(entry) {
  if (!entry) {
    return null;
  }
  return {
    accepted: Boolean(entry.accepted),
    localPassed: Boolean(entry.localPassed),
    workspaceCreated: Boolean(entry.workspaceCreated),
    lastSubmissionLabel: entry.lastSubmissionLabel || "",
    lastSubmissionId: entry.lastSubmissionId || "",
    updatedAt: entry.updatedAt || "",
    attempted: progressEntryAttempted(entry)
  };
}

/**
 * 给站点题目补上本地进度与最终状态。
 * serverAvailable=false 时表示站点数据不可用，全部状态来自本地。
 */
function decorateProblem(problem, localIndex, serverAvailable = true) {
  const local = normalizeLocal(findLocalProgress(localIndex, problem));
  const solvedOnServer = Boolean(problem.solvedOnServer);
  const attemptedOnServer = Boolean(problem.attemptedOnServer);
  const localAccepted = Boolean(local && local.accepted);
  const localAttempted = Boolean(local && local.attempted);

  let status = "todo";
  let statusSource = serverAvailable ? "server" : "local";
  let conflict = false;

  if (solvedOnServer) {
    status = "solved";
    statusSource = localAccepted ? "mixed" : "server";
  } else if (localAccepted) {
    status = "solved";
    statusSource = "local";
    conflict = serverAvailable;
  } else if (attemptedOnServer) {
    status = "attempted";
    statusSource = "server";
  } else if (localAttempted) {
    status = "attempted";
    statusSource = "local";
  }

  return Object.assign({}, problem, {
    local,
    status,
    statusSource,
    conflict,
    passRate:
      problem.submissionNumber > 0
        ? Math.round((problem.acceptedNumber / problem.submissionNumber) * 1000) / 10
        : null
  });
}

function mergeCatalogWithLocal(problems, options = {}) {
  const localIndex = options.localIndex || { byId: new Map(), byDisplayId: new Map() };
  const serverAvailable = options.serverAvailable !== false;
  return (Array.isArray(problems) ? problems : [])
    .filter(Boolean)
    .map((problem) => decorateProblem(problem, localIndex, serverAvailable));
}

function naturalCompare(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  return a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function effectiveStatus(problem) {
  if (problem && problem.status) {
    return problem.status;
  }
  if (problem && (problem.solvedOnServer || (problem.local && problem.local.accepted))) {
    return "solved";
  }
  if (problem && (problem.attemptedOnServer || (problem.local && problem.local.attempted))) {
    return "attempted";
  }
  return "todo";
}

function matchesStatus(problem, status) {
  if (!status || status === "all") {
    return true;
  }
  const current = effectiveStatus(problem);
  if (status === "solved") {
    return current === "solved";
  }
  if (status === "attempted") {
    return current === "attempted";
  }
  if (status === "todo") {
    return current === "todo";
  }
  if (status === "local") {
    return Boolean(problem.local && problem.local.attempted);
  }
  return true;
}

function applyFilters(problems, filters = {}) {
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const difficulty = filters.difficulty && filters.difficulty !== "all" ? filters.difficulty : "";
  const tag = filters.tag && filters.tag !== "all" ? filters.tag : "";
  return (Array.isArray(problems) ? problems : []).filter((problem) => {
    if (!matchesStatus(problem, filters.status)) {
      return false;
    }
    if (difficulty && problem.difficulty !== difficulty) {
      return false;
    }
    if (tag && !(problem.tags || []).includes(tag)) {
      return false;
    }
    if (keyword) {
      const haystack = `${problem.displayId} ${problem.title}`.toLowerCase();
      if (!haystack.includes(keyword)) {
        return false;
      }
    }
    return true;
  });
}

function sortProblems(problems, sortKey = "default") {
  const list = (Array.isArray(problems) ? problems : []).slice();
  const byDisplay = (a, b) => naturalCompare(a.displayId, b.displayId);
  switch (sortKey) {
    case "difficulty":
      return list.sort(
        (a, b) =>
          (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9) ||
          byDisplay(a, b)
      );
    case "passRate":
      return list.sort(
        (a, b) => (b.passRate === null ? -1 : b.passRate) - (a.passRate === null ? -1 : a.passRate) || byDisplay(a, b)
      );
    case "submissions":
      return list.sort((a, b) => b.submissionNumber - a.submissionNumber || byDisplay(a, b));
    case "recent":
      return list.sort(
        (a, b) =>
          Date.parse((b.local && b.local.updatedAt) || "") -
            Date.parse((a.local && a.local.updatedAt) || "") || byDisplay(a, b)
      );
    default:
      return list.sort(byDisplay);
  }
}

function computeCatalogStats(problems) {
  const list = Array.isArray(problems) ? problems : [];
  const stats = {
    total: list.length,
    solved: 0,
    attempted: 0,
    todo: 0,
    localInProgress: 0,
    byDifficulty: {}
  };
  for (const problem of list) {
    const status = effectiveStatus(problem);
    if (status === "solved") {
      stats.solved += 1;
    } else if (status === "attempted") {
      stats.attempted += 1;
    } else {
      stats.todo += 1;
    }
    if (problem.local && problem.local.attempted) {
      stats.localInProgress += 1;
    }
    const key = problem.difficulty || "Unknown";
    if (!stats.byDifficulty[key]) {
      stats.byDifficulty[key] = { total: 0, solved: 0, attempted: 0 };
    }
    const bucket = stats.byDifficulty[key];
    bucket.total += 1;
    if (status === "solved") {
      bucket.solved += 1;
    } else if (status === "attempted") {
      bucket.attempted += 1;
    }
  }
  return stats;
}

function computeDifficultyStats(problems) {
  const stats = computeCatalogStats(problems).byDifficulty;
  return ["Low", "Mid", "High", "Unknown"]
    .filter((key) => stats[key])
    .map((key) => Object.assign({ key, label: key === "Unknown" ? "未标注" : key }, stats[key]));
}

function computeTopTags(problems, limit = 30) {
  const counts = new Map();
  for (const problem of Array.isArray(problems) ? problems : []) {
    for (const tag of problem.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function paginate(problems, page, pageSize) {
  const size = Math.max(1, Number(pageSize) || 50);
  const current = Math.max(1, Number(page) || 1);
  const start = (current - 1) * size;
  return {
    page: current,
    pageSize: size,
    total: Array.isArray(problems) ? problems.length : 0,
    totalPages: Math.max(1, Math.ceil((Array.isArray(problems) ? problems.length : 0) / size)),
    items: (Array.isArray(problems) ? problems : []).slice(start, start + size)
  };
}

module.exports = {
  DIFFICULTY_ORDER,
  buildLocalProgressIndex,
  findLocalProgress,
  normalizeLocal,
  decorateProblem,
  effectiveStatus,
  mergeCatalogWithLocal,
  applyFilters,
  sortProblems,
  computeCatalogStats,
  computeDifficultyStats,
  computeTopTags,
  paginate,
  naturalCompare
};
