/**
 * 全站排名的索引与定位。
 *
 * /api/user_rank 只给分页，没有 my_rank。实测 limit=2000 可用，全站约 5300 人，
 * 因此直接按页拉完并建索引，名次 = offset + 下标 + 1，和站点榜单展示顺序一致。
 */
"use strict";

function metricValue(row, rule) {
  return rule === "oi" ? row.totalScore : row.acceptedNumber;
}

function buildRankIndex(pages, options = {}) {
  const rule = options.rule === "oi" ? "oi" : "acm";
  const byUsername = new Map();
  const rows = [];
  let total = 0;
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page) {
      continue;
    }
    total = Math.max(total, Number(page.total) || 0);
    const offset = Number(page.offset) || 0;
    for (let index = 0; index < (page.results || []).length; index += 1) {
      const row = page.results[index];
      const position = offset + index + 1;
      const entry = Object.assign({}, row, {
        position,
        rank: position,
        metric: metricValue(row, rule)
      });
      rows.push(entry);
      if (!byUsername.has(entry.username)) {
        byUsername.set(entry.username, entry);
      }
      const lower = entry.username.toLowerCase();
      if (!byUsername.has(lower)) {
        byUsername.set(lower, entry);
      }
    }
  }
  return { rule, rows, byUsername, total, truncated: Boolean(options.truncated) };
}

function findRow(index, username) {
  if (!index || !username) {
    return null;
  }
  return index.byUsername.get(username) || index.byUsername.get(String(username).toLowerCase()) || null;
}

function tieRange(rows, row, rule) {
  if (!row || !Array.isArray(rows)) {
    return { start: row ? row.position : 0, end: row ? row.position : 0 };
  }
  const target = metricValue(row, rule);
  let start = row.position;
  let end = row.position;
  for (let i = row.position - 2; i >= 0; i -= 1) {
    if (metricValue(rows[i], rule) !== target) {
      break;
    }
    start = rows[i].position;
  }
  for (let i = row.position; i < rows.length; i += 1) {
    if (metricValue(rows[i], rule) !== target) {
      break;
    }
    end = rows[i].position;
  }
  return { start, end };
}

function locateRank(index, username) {
  if (!index) {
    return { status: "not_found", rank: null, position: null, total: 0, tieStart: null, tieEnd: null };
  }
  const row = findRow(index, username);
  if (!row) {
    return {
      status: "not_found",
      rank: null,
      position: null,
      total: index.total,
      tieStart: null,
      tieEnd: null,
      truncated: index.truncated
    };
  }
  if (row.metric <= 0) {
    return {
      status: "unranked",
      rank: null,
      position: row.position,
      total: index.total,
      tieStart: null,
      tieEnd: null,
      row
    };
  }
  const tie = tieRange(index.rows, row, index.rule);
  return {
    status: "ranked",
    rank: tie.start,
    position: row.position,
    total: index.total,
    tieStart: tie.start,
    tieEnd: tie.end,
    row
  };
}

/** 名次对应的百分位（从榜首算起，1 表示第一）。 */
function rankPercentile(rank, total) {
  if (!Number.isFinite(Number(rank)) || !Number.isFinite(Number(total)) || Number(total) <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (Number(rank) / Number(total)) * 100));
}

function rankRowFromRaw(raw, offset, index) {
  if (!raw) {
    return null;
  }
  const user = raw.user && typeof raw.user === "object" ? raw.user : raw;
  const username = String(user.username || raw.username || "");
  if (!username) {
    return null;
  }
  const position = Number(offset || 0) + Number(index || 0) + 1;
  return {
    position,
    rank: position,
    username,
    avatar: String(raw.avatar || user.avatar || ""),
    school: String(raw.school || user.school || ""),
    mood: String(raw.mood || user.mood || ""),
    acceptedNumber: Number(raw.accepted_number) || 0,
    submissionNumber: Number(raw.submission_number) || 0,
    totalScore: Number(raw.total_score) || 0
  };
}

module.exports = {
  buildRankIndex,
  locateRank,
  rankPercentile,
  rankRowFromRaw,
  metricValue,
  tieRange
};
