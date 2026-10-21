/**
 * 实验/题库列表的“隐藏”记录。
 *
 * 侧边栏会合并两类来源：手动加载并持久化的实验，以及扫盘从本地题目目录恢复的实验。
 * 只从持久化列表删除时，扫盘来源会在下一次 refresh 把它重新加回来，
 * 表现为「删除后没有反应」。因此「从实验列表移除」同时写入隐藏键，
 * 树渲染与清理逻辑都按隐藏键过滤；再次加载同一实验时解除隐藏。
 */
"use strict";

const MAX_HIDDEN_CONTESTS = 200;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function contestEntryKey(entry, fallbackBaseUrl) {
  if (!entry) {
    return "";
  }
  // 树节点（ContestTreeItem）把原始条目放在 .entry 下，且自身没有 key 字段。
  const source = entry.entry && entry.entry.contest ? entry.entry : entry;
  if (source.key) {
    return String(source.key);
  }
  const contest = source.contest || source;
  const id = contest && contest.id !== undefined && contest.id !== null ? String(contest.id) : "";
  if (!id) {
    return "";
  }
  const baseUrl = normalizeBaseUrl(source.baseUrl) || normalizeBaseUrl(fallbackBaseUrl);
  return `${baseUrl}::${id}`;
}

function isContestHidden(hidden, key) {
  if (!key) {
    return false;
  }
  return (hidden || []).some((item) => String(item) === String(key));
}

function hideContest(hidden, key) {
  const list = Array.isArray(hidden) ? hidden.slice() : [];
  if (!key) {
    return list;
  }
  const value = String(key);
  const next = list.filter((item) => String(item) !== value);
  next.push(value);
  return next.slice(-MAX_HIDDEN_CONTESTS);
}

function unhideContest(hidden, key) {
  const list = Array.isArray(hidden) ? hidden : [];
  if (!key) {
    return list.slice();
  }
  return list.filter((item) => String(item) !== String(key));
}

function filterHiddenEntries(entries, hidden) {
  return (entries || []).filter((entry) => !isContestHidden(hidden, contestEntryKey(entry)));
}

module.exports = {
  MAX_HIDDEN_CONTESTS,
  contestEntryKey,
  isContestHidden,
  hideContest,
  unhideContest,
  filterHiddenEntries
};
