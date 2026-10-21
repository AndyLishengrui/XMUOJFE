/**
 * 同题实时竞速：口令、状态机、提交摄入与胜负判定。纯函数，便于测试。
 *
 * 判定一律以服务端提交时间为准；本地计时只用于 UI。
 * 影子竞速已下线：旧版影子口令会被拒绝，新竞速一律为实时模式。
 */
"use strict";

const { parseServerTime, isQuestionBankContest } = require("./siteApi");

const RACE_VERSION = 1;
const MAX_PARTICIPANTS = 6;
const DEFAULT_GRACE_MS = 120 * 1000;
const SETTLE_TIMEOUT_MS = 120 * 1000;
const POLL_BASE_MS = 10 * 1000;
const POLL_MAX_MS = 60 * 1000;
const PENDING_RESULT_KEYS = new Set(["Pending", "Judging", "Submitting"]);

function toIso(value) {
  if (!value) {
    return null;
  }
  return parseServerTime(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function participantNames(participants) {
  return asArray(participants)
    .map((item) => (typeof item === "string" ? item : item && item.username))
    .filter(Boolean)
    .map(String);
}

function normalizeContest(contest) {
  if (!contest || typeof contest !== "object") {
    return null;
  }
  const id = contest.id !== undefined && contest.id !== null && contest.id !== ""
    ? contest.id
    : contest.contestId !== undefined && contest.contestId !== null && contest.contestId !== ""
      ? contest.contestId
      : contest.contest_id;
  if (id === undefined || id === null || id === "") {
    return null;
  }
  return {
    id,
    title: String(contest.title || contest.name || ""),
    isQuestionBank:
      contest.isQuestionBank === undefined
        ? isQuestionBankContest(contest)
        : Boolean(contest.isQuestionBank)
  };
}

function createRaceRecord(input = {}) {
  const now = toIso(input.now) || new Date().toISOString();
  const participants = participantNames(input.participants);
  return {
    id: input.id || `race_${Date.parse(now).toString(36)}`,
    version: RACE_VERSION,
    mode: "live",
    contest: normalizeContest(input.contest),
    problem: {
      id: input.problem ? input.problem.id : null,
      displayId: String(input.problem ? input.problem.displayId || input.problem.display_id || "" : ""),
      title: String(input.problem ? input.problem.title || "" : "")
    },
    host: input.host || participants[0] || "",
    participants: participants.map((username) => ({
      username,
      status: "waiting",
      submissions: [],
      acceptedAt: null,
      acceptedSubmissionId: null
    })),
    startAt: toIso(input.startAt) || now,
    deadlineAt: toIso(input.deadlineAt) || new Date(Date.parse(now) + 60 * 60 * 1000).toISOString(),
    createdAt: now,
    updatedAt: now,
    status: input.startAt && Date.parse(input.startAt) > Date.parse(now) ? "armed" : "running",
    winner: null,
    tie: false,
    events: [],
    lastPollAt: null,
    lastPollError: null,
    pollFailures: 0,
    degraded: false
  };
}

function base64UrlEncode(text) {
  return Buffer.from(text, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const normalized = String(text).replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  const source = String(text);
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function raceToToken(race) {
  const payload = {
    v: RACE_VERSION,
    kind: "live",
    id: race.id,
    contest: race.contest || undefined,
    problem: race.problem,
    host: race.host,
    participants: participantNames(race.participants),
    startAt: race.startAt,
    deadlineAt: race.deadlineAt,
    createdAt: race.createdAt
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `XMJ1.${encoded}.${fnv1a(encoded)}`;
}

function raceFromToken(token) {
  const raw = String(token || "").trim();
  if (!raw || raw.length > 2048) {
    return { ok: false, error: "竞速口令为空或过长" };
  }
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "XMJ1") {
    return { ok: false, error: "不是有效的 XMUOJ 竞速口令" };
  }
  if (fnv1a(parts[1]) !== parts[2]) {
    return { ok: false, error: "竞速口令校验失败，可能被截断或修改" };
  }
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch (_error) {
    return { ok: false, error: "竞速口令内容无法解析" };
  }
  if (!payload || payload.v !== RACE_VERSION) {
    return { ok: false, error: "竞速口令版本不兼容，请升级插件" };
  }
  if (payload.kind === "shadow") {
    return { ok: false, error: "旧版影子竞速口令已停用，请让房主重新发起实时竞速" };
  }
  if (payload.kind !== "live") {
    return { ok: false, error: "不是有效的实时竞速口令" };
  }
  const participants = participantNames(payload.participants);
  if (!participants.length || participants.length > MAX_PARTICIPANTS) {
    return { ok: false, error: `竞速人数必须在 1-${MAX_PARTICIPANTS} 人之间` };
  }
  if (!payload.problem || !payload.problem.displayId) {
    return { ok: false, error: "竞速口令缺少题目信息" };
  }
  const startAt = toIso(payload.startAt);
  const deadlineAt = toIso(payload.deadlineAt);
  if (!startAt || !deadlineAt || Date.parse(deadlineAt) <= Date.parse(startAt)) {
    return { ok: false, error: "竞速时间无效" };
  }
  return {
    ok: true,
    race: createRaceRecord({
      id: payload.id,
      mode: payload.kind,
      contest: payload.contest,
      problem: payload.problem,
      host: payload.host,
      participants,
      startAt,
      deadlineAt,
      createdAt: payload.createdAt
    })
  };
}

function compareSubmissionIds(left, right) {
  const a = String(left === undefined || left === null ? "" : left);
  const b = String(right === undefined || right === null ? "" : right);
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
    return na - nb;
  }
  return a.localeCompare(b);
}

/** 摄入一条公开提交；按 username + submissionId 去重。 */
function recordSubmission(race, submission, now) {
  if (!race || !submission || !submission.username) {
    return race;
  }
  const username = String(submission.username);
  const participant = (race.participants || []).find((item) => item.username === username);
  if (!participant) {
    return race;
  }
  const submissionId = submission.id !== undefined && submission.id !== null ? String(submission.id) : "";
  const dedupeKey = `${username}:${submissionId || `${submission.createdAt}:${submission.resultKey}`}`;
  const resultKey = submission.resultKey || "Unknown";
  const existing = (race.events || []).find((event) => event.dedupeKey === dedupeKey);
  if (existing) {
    // 轮询可能先看到 Pending/Judging，判完后同一提交会变成终态。
    // 只允许"升级"（进入 AC，或从等待态进入终态），不能把已出结果的记录降级。
    const upgrade = resultKey === "AC" ||
      (PENDING_RESULT_KEYS.has(existing.resultKey) && !PENDING_RESULT_KEYS.has(resultKey));
    if (!upgrade || existing.resultKey === resultKey) {
      return race;
    }
    const patch = { resultCode: submission.resultCode, resultKey, updatedAt: toIso(now) || new Date().toISOString() };
    const events = race.events.map((event) =>
      event.dedupeKey === dedupeKey ? Object.assign({}, event, patch) : event
    );
    const submissions = (participant.submissions || []).map((event) =>
      event.dedupeKey === dedupeKey ? Object.assign({}, event, patch) : event
    );
    let acceptedAt = participant.acceptedAt;
    let acceptedSubmissionId = participant.acceptedSubmissionId;
    if (resultKey === "AC" && !acceptedAt) {
      acceptedAt = existing.createdAt || submission.createdAt;
      acceptedSubmissionId = submissionId;
    }
    const updatedParticipant = Object.assign({}, participant, {
      submissions,
      acceptedAt,
      acceptedSubmissionId,
      status: acceptedAt
        ? "accepted"
        : PENDING_RESULT_KEYS.has(resultKey) ? "submitted_pending" : "running"
    });
    return Object.assign({}, race, {
      participants: race.participants.map((item) =>
        item.username === username ? updatedParticipant : item
      ),
      events,
      updatedAt: toIso(now) || new Date().toISOString()
    });
  }
  const createdAt = submission.createdAt;
  const event = {
    username,
    submissionId,
    resultCode: submission.resultCode,
    resultKey,
    createdAt,
    discoveredAt: toIso(now) || new Date().toISOString(),
    dedupeKey
  };
  const events = (race.events || []).concat(event);
  const submissions = (participant.submissions || []).concat(event);
  let acceptedAt = participant.acceptedAt;
  let acceptedSubmissionId = participant.acceptedSubmissionId;
  if (event.resultKey === "AC" && !acceptedAt) {
    acceptedAt = createdAt;
    acceptedSubmissionId = submissionId;
  }
  const updatedParticipant = Object.assign({}, participant, {
    submissions,
    acceptedAt,
    acceptedSubmissionId,
    status: acceptedAt
      ? "accepted"
      : PENDING_RESULT_KEYS.has(event.resultKey) ? "submitted_pending" : "running"
  });
  return Object.assign({}, race, {
    participants: race.participants.map((item) =>
      item.username === username ? updatedParticipant : item
    ),
    events,
    updatedAt: toIso(now) || new Date().toISOString()
  });
}

function pickWinner(race) {
  const accepted = (race.participants || [])
    .filter((item) => item.acceptedAt)
    .sort(
      (a, b) =>
        Date.parse(a.acceptedAt) - Date.parse(b.acceptedAt) ||
        compareSubmissionIds(a.acceptedSubmissionId, b.acceptedSubmissionId)
    );
  if (!accepted.length) {
    return null;
  }
  const first = accepted[0];
  const tied = accepted.filter(
    (item) =>
      Date.parse(item.acceptedAt) === Date.parse(first.acceptedAt) &&
      compareSubmissionIds(item.acceptedSubmissionId, first.acceptedSubmissionId) === 0
  );
  return { winner: first.username, tie: tied.length > 1 };
}

/**
 * 已经有人 AC 时，找出"提交时间不晚于首个 AC、但判题结果还没出"的提交。
 * 这些提交有可能以更早的服务端时间拿到 AC，必须等它们落定后再宣布胜者。
 */
function pendingBeforeFirstAcceptance(race) {
  const acceptedTimes = (race.participants || [])
    .map((item) => Date.parse(item.acceptedAt))
    .filter((value) => Number.isFinite(value));
  if (!acceptedTimes.length) {
    return [];
  }
  const firstAcceptedMs = Math.min(...acceptedTimes);
  return (race.events || [])
    .filter((event) => PENDING_RESULT_KEYS.has(event.resultKey))
    .map((event) => Date.parse(event.createdAt))
    .filter((value) => Number.isFinite(value) && value <= firstAcceptedMs);
}

function evaluateRace(race, now, options = {}) {
  if (!race) {
    return { status: "cancelled", winner: null, tie: false };
  }
  if (race.status === "cancelled") {
    return { status: "cancelled", winner: null, tie: false };
  }
  const nowMs = Date.parse(toIso(now) || new Date().toISOString());
  const startMs = Date.parse(race.startAt);
  const deadlineMs = Date.parse(race.deadlineAt);
  const graceMs = Number(options.graceMs) || DEFAULT_GRACE_MS;
  const result = pickWinner(race);
  if (result) {
    const pending = pendingBeforeFirstAcceptance(race);
    if (pending.length) {
      // 给更早的未判提交最多 120 秒落定；超时或超过截止宽限后按已确认结果结束。
      const settleUntil = Math.max(...pending) + SETTLE_TIMEOUT_MS;
      if (nowMs < settleUntil && nowMs <= deadlineMs + graceMs) {
        return { status: "settling", winner: null, tie: false, settling: true };
      }
    }
    return { status: "finished", winner: result.winner, tie: result.tie };
  }
  if (nowMs < startMs) {
    return { status: "armed", winner: null, tie: false };
  }
  if (nowMs > deadlineMs + graceMs) {
    return { status: "finished", winner: null, tie: false, noWinner: true };
  }
  return { status: "running", winner: null, tie: false };
}

function isTerminal(race) {
  return Boolean(race && ["finished", "expired", "cancelled"].includes(race.status));
}

/** 轮询退避；认证失败直接暂停。 */
function nextPollDelay(failures, errorKind, baseMs = POLL_BASE_MS) {
  if (errorKind === "auth") {
    return { delayMs: 0, paused: true };
  }
  const count = Math.max(0, Number(failures) || 0);
  if (!count) {
    return { delayMs: baseMs, paused: false };
  }
  const delay = Math.min(POLL_MAX_MS, baseMs * Math.pow(2, count));
  return { delayMs: delay, paused: count >= 10 };
}

function raceSummary(race) {
  const total = (race && race.participants ? race.participants : []).length;
  const accepted = (race && race.participants ? race.participants : []).filter((item) => item.acceptedAt).length;
  return {
    participants: total,
    accepted,
    submissions: (race && race.events ? race.events : []).length
  };
}

module.exports = {
  RACE_VERSION,
  MAX_PARTICIPANTS,
  DEFAULT_GRACE_MS,
  POLL_BASE_MS,
  POLL_MAX_MS,
  normalizeContest,
  createRaceRecord,
  raceToToken,
  raceFromToken,
  recordSubmission,
  evaluateRace,
  pickWinner,
  isTerminal,
  nextPollDelay,
  raceSummary,
  base64UrlEncode,
  base64UrlDecode,
  fnv1a,
  compareSubmissionIds
};
