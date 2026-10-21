/**
 * 本地数据整理（版本升级/首次安装）用到的纯函数。
 *
 * 重点解决一件事：早期版本只把实验的 id/title/status 存进 globalState，
 * 没有保存服务端的 is_question_bank / is_exam，于是“我的题库”里的教材题库
 * 会被当成普通实验。这里负责把服务端标记合并进已加载条目，并保存一份
 * contestId → 标记 的索引，供扫盘得到的实验在离线时也能正确归类。
 *
 * 本模块不依赖 vscode，便于单测。
 */
"use strict";

const DATA_MIGRATION_VERSION = 2;
const DATA_MIGRATION_KEY = "xmuoj.dataMigrationVersion";
const CONTEST_METADATA_KEY = "xmuoj.contestMetadata.v1";

/** 只保存判定与展示需要的小字段，避免 globalState 膨胀。 */
const CONTEST_METADATA_FIELDS = [
  "is_question_bank",
  "is_exam",
  "contest_type",
  "real_time_rank",
  "require_password"
];

function normalizeContestId(value) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return String(value);
}

/** 从服务端实验对象里摘出需要长期保存的标记。 */
function pickContestMetadata(contest) {
  if (!contest || typeof contest !== "object") {
    return null;
  }
  const id = normalizeContestId(contest.id);
  if (!id) {
    return null;
  }
  const metadata = { id: contest.id };
  for (const field of CONTEST_METADATA_FIELDS) {
    if (contest[field] !== undefined && contest[field] !== null) {
      metadata[field] = contest[field];
    }
  }
  if (contest.title) {
    metadata.title = String(contest.title);
  }
  if (contest.status !== undefined && contest.status !== null) {
    metadata.status = contest.status;
  }
  return metadata;
}

/** 服务端实验列表 → { [id]: metadata }。 */
function buildContestMetadataMap(contests) {
  const map = {};
  for (const contest of Array.isArray(contests) ? contests : []) {
    const metadata = pickContestMetadata(contest);
    if (!metadata) {
      continue;
    }
    map[normalizeContestId(metadata.id)] = metadata;
  }
  return map;
}

/**
 * 把 metadata 合并进实验对象。
 *
 * 默认只补缺失字段（树上的扫盘条目、刚加载的实验）；
 * override=true 时以 metadata 为准（从服务端刷新已加载条目）。
 */
function mergeContestMetadata(contest, metadata, options = {}) {
  if (!contest || typeof contest !== "object") {
    return contest;
  }
  if (!metadata || typeof metadata !== "object") {
    return contest;
  }
  const override = options.override === true;
  const merged = Object.assign({}, contest);
  for (const field of CONTEST_METADATA_FIELDS) {
    if (metadata[field] === undefined || metadata[field] === null) {
      continue;
    }
    if (override || merged[field] === undefined || merged[field] === null) {
      merged[field] = metadata[field];
    }
  }
  if (metadata.title && (override || !merged.title)) {
    merged.title = metadata.title;
  }
  if (
    metadata.status !== undefined
    && metadata.status !== null
    && (override || merged.status === undefined || merged.status === null)
  ) {
    merged.status = metadata.status;
  }
  return merged;
}

function metadataForContest(map, contestId) {
  const id = normalizeContestId(contestId);
  if (!id || !map || typeof map !== "object") {
    return null;
  }
  return map[id] || null;
}

/** 已加载实验条目：用服务端标记刷新，返回新数组（不改原对象）。 */
function mergeLoadedContestMetadata(entries, map, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  return list.map((entry) => {
    if (!entry || !entry.contest) {
      return entry;
    }
    const metadata = metadataForContest(map, entry.contest.id);
    if (!metadata) {
      return entry;
    }
    return Object.assign({}, entry, {
      contest: mergeContestMetadata(entry.contest, metadata, options)
    });
  });
}

/** 服务端是否已经明确给出了题库/考试判定（true 或 false 都算）。 */
function hasContestClassification(contest) {
  if (!contest || typeof contest !== "object") {
    return false;
  }
  const bank = contest.is_question_bank !== undefined
    ? contest.is_question_bank
    : contest.isQuestionBank;
  const exam = contest.is_exam !== undefined ? contest.is_exam : contest.isExam;
  return bank !== undefined && bank !== null && exam !== undefined && exam !== null;
}

/** 找出还没有服务端判定的实验 id（去重，用于决定是否需要刷新）。 */
function contestsMissingClassification(entries, map) {
  const missing = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || !entry.contest || entry.contest.id === undefined || entry.contest.id === null) {
      continue;
    }
    const merged = mergeContestMetadata(
      entry.contest,
      metadataForContest(map, entry.contest.id)
    );
    if (!hasContestClassification(merged)) {
      missing.add(normalizeContestId(entry.contest.id));
    }
  }
  return Array.from(missing);
}

module.exports = {
  DATA_MIGRATION_VERSION,
  DATA_MIGRATION_KEY,
  CONTEST_METADATA_KEY,
  CONTEST_METADATA_FIELDS,
  normalizeContestId,
  pickContestMetadata,
  buildContestMetadataMap,
  mergeContestMetadata,
  metadataForContest,
  mergeLoadedContestMetadata,
  hasContestClassification,
  contestsMissingClassification
};
