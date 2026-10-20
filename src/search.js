/**
 * 统一搜索的纯函数与在线检索编排。
 *
 * 本地过滤不依赖 vscode，便于单测；extension.js 只负责 QuickPick 交互。
 */
"use strict";

const store = require("./workspaceStore");

function normalizeKeyword(keyword) {
  return String(keyword || "").trim().toLowerCase();
}

/**
 * 本地工作区过滤：匹配展示号、标题、实验名。
 * 空关键词返回全部条目（保持传入顺序）。
 */
function filterLocalWorkspaces(entries, keyword) {
  const list = Array.isArray(entries) ? entries : [];
  const needle = normalizeKeyword(keyword);
  if (!needle) {
    return list.slice();
  }
  return list.filter((entry) => {
    if (!entry) {
      return false;
    }
    const haystack = [
      entry.displayId,
      entry.display_id,
      entry.title,
      entry.contestTitle,
      entry.problemId
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** 把 index.entries 转成演示用的扁平列表（按最近更新时间倒序）。 */
function collectLocalEntries(index) {
  if (!index || !index.entries) {
    return [];
  }
  return Object.values(index.entries)
    .filter((entry) => entry && entry.problemId !== undefined && entry.problemId !== null)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .map((entry) => ({
      identity: entry.identity || store.buildProblemIdentity(entry.baseUrl || "", entry.problemId),
      baseUrl: entry.baseUrl || "",
      problemId: entry.problemId,
      displayId: entry.displayId || "",
      title: entry.title || "",
      contestId: entry.contestId === undefined ? null : entry.contestId,
      contestTitle: entry.contestTitle || null,
      dir: entry.dir || null,
      legacy: Boolean(entry.legacy)
    }));
}

/**
 * 并行搜索公共题目与实验。任一请求失败不影响另一类结果。
 * 返回 { problems, contests, problemsError, contestsError }。
 */
async function searchOnline(client, keyword, options = {}) {
  const problemsLimit = options.problemsLimit || 30;
  const contestsLimit = options.contestsLimit || 20;
  const [problemsResult, contestsResult] = await Promise.allSettled([
    client.getProblemset({ keyword, limit: problemsLimit, offset: 0 }),
    client.getContests({ keyword, limit: contestsLimit, offset: 0 })
  ]);
  return {
    problems: problemsResult.status === "fulfilled" ? (problemsResult.value.results || []) : [],
    contests: contestsResult.status === "fulfilled" ? (contestsResult.value.results || []) : [],
    problemsError: problemsResult.status === "rejected" ? problemsResult.reason : null,
    contestsError: contestsResult.status === "rejected" ? contestsResult.reason : null
  };
}

module.exports = {
  normalizeKeyword,
  filterLocalWorkspaces,
  collectLocalEntries,
  searchOnline
};
