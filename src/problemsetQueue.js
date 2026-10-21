/**
 * 公共题库队列的纯函数实现。
 *
 * 旧实现（extension.js）在 upsert 时先删除再 concat，导致打开任意题目都会把它
 * 移到队尾；next 又依赖全局 activeProblem，只有一道题或游标失效时行为异常。
 * 这里把顺序与游标逻辑收敛到不依赖 vscode 的模块，便于测试。
 */
"use strict";

const MAX_SELECTIONS = 100;

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function selectionKey(item, baseUrl) {
  if (!item) {
    return "";
  }
  return `${normalizeBaseUrl(baseUrl || item.baseUrl)}::${String(item.id)}`;
}

function selectionId(item) {
  if (!item) {
    return "";
  }
  if (item.id !== undefined && item.id !== null && item.id !== "") {
    return String(item.id);
  }
  return String(item.display_id || item.displayId || "");
}

function normalizeSelection(problem, baseUrl) {
  if (!problem) {
    return null;
  }
  return {
    id: problem.id,
    display_id: problem.display_id || problem.displayId || "",
    title: problem.title || "",
    difficulty: problem.difficulty || "",
    languages: Array.isArray(problem.languages) ? problem.languages.slice() : [],
    baseUrl: baseUrl || problem.baseUrl
  };
}

function filterSelections(items, baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  return (Array.isArray(items) ? items : []).filter(
    (item) => normalizeBaseUrl((item && item.baseUrl) || baseUrl) === normalized
  );
}

function upsertSelection(items, problem, baseUrl, options = {}) {
  const nextItem = normalizeSelection(problem, baseUrl);
  if (!nextItem) {
    return Array.isArray(items) ? items.slice() : [];
  }
  const key = selectionKey(nextItem, baseUrl);
  const source = Array.isArray(items) ? items.slice() : [];
  const index = source.findIndex((item) => selectionKey(item, baseUrl || item.baseUrl) === key);
  if (index >= 0) {
    // 原位更新，不改变刷题顺序。
    source[index] = Object.assign({}, source[index], nextItem);
    return source.slice(0, options.limit || MAX_SELECTIONS);
  }
  return source.concat(nextItem).slice(-(options.limit || MAX_SELECTIONS));
}

function removeSelection(items, item, baseUrl) {
  const key = selectionKey(item, baseUrl || (item && item.baseUrl));
  return (Array.isArray(items) ? items : []).filter(
    (entry) => selectionKey(entry, baseUrl || (entry && entry.baseUrl)) !== key
  );
}

function moveSelectionToTop(items, problem, baseUrl) {
  const list = Array.isArray(items) ? items.slice() : [];
  const nextItem = normalizeSelection(problem, baseUrl);
  if (!nextItem) {
    return list;
  }
  const key = selectionKey(nextItem, baseUrl);
  const existing = list.find((item) => selectionKey(item, baseUrl || item.baseUrl) === key);
  const rest = list.filter((item) => selectionKey(item, baseUrl || item.baseUrl) !== key);
  return [Object.assign({}, existing || nextItem, nextItem)].concat(rest);
}

/**
 * 游标模型：cursorKey 是上一次打开的题目 key。
 * - 没有游标或游标不在当前站点队列中 → 第一题
 * - 游标在队列中间 → 下一题
 * - 游标在末尾 → 回绕到第一题（而不是返回 null）
 */
function nextSelection(items, cursorKey, baseUrl, options = {}) {
  const list = filterSelections(items, baseUrl);
  if (!list.length) {
    return null;
  }
  const index = list.findIndex((item) => selectionKey(item, baseUrl || item.baseUrl) === String(cursorKey || ""));
  if (index < 0) {
    return list[0];
  }
  const wrap = options.wrap !== false;
  const nextIndex = index + 1;
  if (nextIndex < list.length) {
    return list[nextIndex];
  }
  return wrap ? list[0] : null;
}

function randomSelection(items, baseUrl, randomFn = Math.random) {
  const list = filterSelections(items, baseUrl);
  if (!list.length) {
    return null;
  }
  const value = typeof randomFn === "function" ? randomFn() : Math.random();
  const index = Math.min(list.length - 1, Math.max(0, Math.floor(value * list.length)));
  return list[index];
}

function buildCursor(item, baseUrl) {
  if (!item) {
    return "";
  }
  return selectionKey(item, baseUrl || item.baseUrl);
}

module.exports = {
  MAX_SELECTIONS,
  normalizeBaseUrl,
  selectionKey,
  selectionId,
  normalizeSelection,
  filterSelections,
  upsertSelection,
  removeSelection,
  moveSelectionToTop,
  nextSelection,
  randomSelection,
  buildCursor
};
