/**
 * 题库洞察：把站点公开提交记录聚合成“对手最近做过哪些题”和“本题首 AC 榜”。
 * 纯函数，不依赖 vscode/网络，便于测试。
 */
"use strict";

function timeValue(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isAccepted(submission) {
  return Boolean(
    submission &&
      (submission.resultKey === "AC" || Number(submission.resultCode) === 0)
  );
}

function displayIdOf(submission) {
  return submission && submission.problemDisplayId
    ? String(submission.problemDisplayId)
    : "";
}

/**
 * 按题目聚合一个用户最近的提交。
 * 返回的 acceptedAt 是本次窗口内最早的一次 AC；窗口被截断时不能当作全站首 AC。
 */
function aggregateUserHistory(submissions) {
  const byProblem = new Map();
  const list = Array.isArray(submissions) ? submissions : [];
  let counted = 0;
  for (const submission of list) {
    const displayId = displayIdOf(submission);
    if (!displayId) {
      continue;
    }
    counted += 1;
    const at = timeValue(submission.createdAt);
    const accepted = isAccepted(submission);
    let row = byProblem.get(displayId);
    if (!row) {
      row = {
        displayId,
        title: "",
        attempts: 0,
        accepted: false,
        acceptedAt: null,
        latestAt: null,
        latestResultKey: "",
        latestResultLabel: "",
        language: ""
      };
      byProblem.set(displayId, row);
    }
    row.attempts += 1;
    if (!row.title && submission.problemTitle) {
      row.title = String(submission.problemTitle);
    }
    if (accepted) {
      row.accepted = true;
      if (!row.acceptedAt || (at && at < timeValue(row.acceptedAt))) {
        row.acceptedAt = submission.createdAt || row.acceptedAt;
      }
    }
    if (!row.latestAt || at >= timeValue(row.latestAt)) {
      row.latestAt = submission.createdAt || row.latestAt;
      row.latestResultKey = submission.resultKey || "";
      row.latestResultLabel =
        submission.resultLabel || submission.resultKey || "";
      row.language = submission.language || "";
    }
  }
  const problems = Array.from(byProblem.values()).sort(
    (a, b) =>
      timeValue(b.latestAt) - timeValue(a.latestAt) ||
      a.displayId.localeCompare(b.displayId, "zh-Hans-CN", { numeric: true })
  );
  return {
    problems,
    submissionCount: counted,
    solvedCount: problems.filter((problem) => problem.accepted).length,
    attemptedOnlyCount: problems.filter((problem) => !problem.accepted).length
  };
}

function sortByAcceptedAt(a, b) {
  return (
    timeValue(a.acceptedAt) - timeValue(b.acceptedAt) ||
    String(a.username).localeCompare(String(b.username), "zh-Hans-CN", {
      sensitivity: "base"
    })
  );
}

function sortByDuration(a, b) {
  const left = a.durationMs === null ? Infinity : a.durationMs;
  const right = b.durationMs === null ? Infinity : b.durationMs;
  return (
    left - right ||
    timeValue(a.acceptedAt) - timeValue(b.acceptedAt) ||
    String(a.username).localeCompare(String(b.username), "zh-Hans-CN", {
      sensitivity: "base"
    })
  );
}

function sortByAcCount(a, b) {
  return (
    b.acCount - a.acCount ||
    timeValue(a.acceptedAt) - timeValue(b.acceptedAt) ||
    String(a.username).localeCompare(String(b.username), "zh-Hans-CN", {
      sensitivity: "base"
    })
  );
}

function withRank(rows, sorter) {
  return rows
    .slice()
    .sort(sorter)
    .map((row, index) => Object.assign({}, row, { rank: index + 1 }));
}

/**
 * 汇总每位用户的提交：首次提交、首次 AC、AC 次数、全部尝试次数。
 * 传入全部提交时 attempts / durationMs 才完整；仅有 AC 提交时用时为 null。
 */
function collectUsers(submissions, { acceptedOnly = false } = {}) {
  const byUser = new Map();
  for (const submission of submissions) {
    const username = String((submission && submission.username) || "");
    if (!username) {
      continue;
    }
    const accepted = isAccepted(submission);
    if (acceptedOnly && !accepted) {
      continue;
    }
    const at = timeValue(submission.createdAt);
    let row = byUser.get(username);
    if (!row) {
      row = {
        username,
        firstAttemptAt: null,
        acceptedAt: null,
        latestAcceptedAt: null,
        latestAt: null,
        acCount: 0,
        attempts: 0
      };
      byUser.set(username, row);
    }
    row.attempts += 1;
    if (at && (!row.firstAttemptAt || at < timeValue(row.firstAttemptAt))) {
      row.firstAttemptAt = submission.createdAt;
    }
    if (accepted) {
      row.acCount += 1;
      if (!row.acceptedAt || (at && at < timeValue(row.acceptedAt))) {
        row.acceptedAt = submission.createdAt || row.acceptedAt;
      }
      if (!row.latestAcceptedAt || at > timeValue(row.latestAcceptedAt)) {
        row.latestAcceptedAt = submission.createdAt || row.latestAcceptedAt;
      }
    }
    if (at && (!row.latestAt || at > timeValue(row.latestAt))) {
      row.latestAt = submission.createdAt;
    }
  }
  return Array.from(byUser.values()).map((row) => {
    const start = timeValue(row.firstAttemptAt);
    const accepted = timeValue(row.acceptedAt);
    return Object.assign({}, row, {
      durationMs:
        row.acceptedAt && row.firstAttemptAt && start <= accepted
          ? accepted - start
          : null
    });
  });
}

/**
 * 本题榜单：
 * - rows：按首次 AC 时间排序（历史首杀顺序）
 * - fastest：按“首次提交 → 首次 AC”用时排序（跨年份可比）
 * - mostAccepted：按 AC 次数排序（反复练习）
 * submissions 为本题全部公开提交时，attempts / durationMs 才完整；
 * 只传 acSubmissions 时保留旧行为，durationMs 为 null。
 */
function buildProblemLeaderboard(options = {}) {
  const allSubmissions = Array.isArray(options.submissions)
    ? options.submissions
    : [];
  const acSubmissions = Array.isArray(options.acSubmissions)
    ? options.acSubmissions
    : [];
  const recentSubmissions = Array.isArray(options.recentSubmissions)
    ? options.recentSubmissions
    : allSubmissions.slice(0, 50);
  const users = allSubmissions.length
    ? collectUsers(allSubmissions)
    : collectUsers(acSubmissions, { acceptedOnly: true }).map((row) =>
        // 只有 AC 记录时无法知道首次提交时间，不能把用时算成 0。
        Object.assign({}, row, { attempts: row.acCount, durationMs: null })
      );
  const acceptedUsers = users.filter((row) => row.acceptedAt);
  const rows = withRank(acceptedUsers, sortByAcceptedAt);
  const fastest = withRank(acceptedUsers, sortByDuration);
  const mostAccepted = withRank(acceptedUsers, sortByAcCount);

  const submissionTotal = Number(options.submissionTotal) || 0;
  const acTotal = Number(options.acTotal) || 0;
  return {
    rows,
    fastest,
    mostAccepted,
    speedAvailable: fastest.some((row) => row.durationMs !== null),
    recent: recentSubmissions.slice(0, 50),
    submissionTotal,
    acTotal,
    uniqueAcceptedUsers: rows.length,
    passRate:
      submissionTotal > 0
        ? Math.round((acTotal / submissionTotal) * 1000) / 10
        : null,
    truncated: Boolean(options.truncated)
  };
}

module.exports = {
  aggregateUserHistory,
  buildProblemLeaderboard
};
