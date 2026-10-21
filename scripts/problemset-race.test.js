/**
 * 同题实时竞速：口令、提交摄入、判定与退避测试。
 */
"use strict";

const assert = require("assert");
const race = require("../src/problemsetRace");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function submission(id, username, resultKey, createdAt) {
  return {
    id,
    username,
    problemDisplayId: "GW001",
    resultKey,
    resultCode: resultKey === "AC" ? 0 : -1,
    createdAt
  };
}

console.log("problemset race");

check("竞速口令往返", () => {
  const record = race.createRaceRecord({
    id: "race_1",
    mode: "live",
    problem: { id: 11, displayId: "GW001", title: "输出第二个整数" },
    host: "alice",
    participants: ["alice", "bob"],
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z",
    now: "2026-10-20T09:59:00Z"
  });
  const token = race.raceToToken(record);
  assert.ok(token.startsWith("XMJ1."));
  const decoded = race.raceFromToken(token);
  assert.strictEqual(decoded.ok, true);
  assert.strictEqual(decoded.race.problem.displayId, "GW001");
  assert.deepStrictEqual(decoded.race.participants.map((item) => item.username), ["alice", "bob"]);
});

check("篡改口令与非法人数被拒绝", () => {
  const record = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  const token = race.raceToToken(record);
  const tampered = `${token.slice(0, -1)}0`;
  assert.strictEqual(race.raceFromToken(tampered).ok, false);
  assert.strictEqual(race.raceFromToken("hello").ok, false);
  const tooMany = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["a", "b", "c", "d", "e", "f", "g"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  assert.strictEqual(race.raceFromToken(race.raceToToken(tooMany)).ok, false);
});

check("题库口令携带实验身份并可往返", () => {
  const record = race.createRaceRecord({
    mode: "live",
    contest: { id: 9001, title: "[教材] 程序设计基础", isQuestionBank: true },
    problem: { id: 101, displayId: "PTA1.1", title: "求两数之和" },
    host: "alice",
    participants: ["alice", "bob"],
    startAt: "2026-10-20T10:00:15Z",
    deadlineAt: "2026-10-20T11:00:00Z",
    now: "2026-10-20T10:00:00Z"
  });
  const decoded = race.raceFromToken(race.raceToToken(record));
  assert.strictEqual(decoded.ok, true);
  assert.deepStrictEqual(decoded.race.contest, {
    id: 9001,
    title: "[教材] 程序设计基础",
    isQuestionBank: true
  });
  assert.strictEqual(decoded.race.problem.displayId, "PTA1.1");
});

check("实验身份归一化：兼容 contest_id 与题库标记缺失", () => {
  assert.deepStrictEqual(race.normalizeContest({ contest_id: 7, title: "[教材] 数学" }), {
    id: 7,
    title: "[教材] 数学",
    isQuestionBank: true
  });
  assert.deepStrictEqual(
    race.normalizeContest({ id: 8, title: "第一次实验", isQuestionBank: false }),
    { id: 8, title: "第一次实验", isQuestionBank: false }
  );
  assert.strictEqual(race.createRaceRecord({ problem: { displayId: "GW001" } }).contest, null);
});

check("竞速只创建实时模式，影子能力已移除", () => {
  const record = race.createRaceRecord({
    mode: "shadow",
    problem: { displayId: "GW001" },
    participants: ["alice"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  assert.strictEqual(record.mode, "live");
  assert.strictEqual(record.shadow, undefined);
  assert.strictEqual(typeof race.buildGhostTarget, "undefined");
  assert.strictEqual(typeof race.evaluateShadow, "undefined");
});

check("旧版影子口令被明确拒绝", () => {
  const payload = {
    v: race.RACE_VERSION,
    kind: "shadow",
    id: "race_old",
    problem: { id: 11, displayId: "GW001", title: "输出第二个整数" },
    host: "alice",
    participants: ["alice"],
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z",
    createdAt: "2026-10-20T09:59:00Z"
  };
  const encoded = race.base64UrlEncode(JSON.stringify(payload));
  const result = race.raceFromToken(`XMJ1.${encoded}.${race.fnv1a(encoded)}`);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes("影子竞速"));
});

check("提交摄入按 id 去重，首个 AC 记录时间", () => {
  let record = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice", "bob"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  const wa = submission("s1", "alice", "WA", "2026-10-20T10:01:00Z");
  record = race.recordSubmission(record, wa, "2026-10-20T10:01:10Z");
  record = race.recordSubmission(record, wa, "2026-10-20T10:01:20Z");
  assert.strictEqual(record.events.length, 1);
  record = race.recordSubmission(
    record,
    submission("s2", "alice", "AC", "2026-10-20T10:05:00Z"),
    "2026-10-20T10:05:10Z"
  );
  const alice = record.participants.find((item) => item.username === "alice");
  assert.strictEqual(alice.status, "accepted");
  assert.strictEqual(alice.acceptedAt, "2026-10-20T10:05:00Z");
  assert.strictEqual(race.evaluateRace(record, "2026-10-20T10:06:00Z").winner, "alice");
});

check("同一提交从 Pending 升级为 AC，不会被去重锁死", () => {
  let record = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  const pending = Object.assign(submission("s1", "alice", "Pending", "2026-10-20T10:01:00Z"), {
    resultCode: 6
  });
  record = race.recordSubmission(record, pending, "2026-10-20T10:01:10Z");
  let alice = record.participants.find((item) => item.username === "alice");
  assert.strictEqual(alice.status, "submitted_pending");
  assert.strictEqual(alice.acceptedAt, null);

  const accepted = submission("s1", "alice", "AC", "2026-10-20T10:01:00Z");
  record = race.recordSubmission(record, accepted, "2026-10-20T10:01:20Z");
  alice = record.participants.find((item) => item.username === "alice");
  assert.strictEqual(record.events.length, 1);
  assert.strictEqual(record.events[0].resultKey, "AC");
  assert.strictEqual(alice.status, "accepted");
  assert.strictEqual(alice.acceptedAt, "2026-10-20T10:01:00Z");
  assert.strictEqual(race.evaluateRace(record, "2026-10-20T10:02:00Z").winner, "alice");

  // 后续轮询即使又返回旧的 Pending，也不能把已判定的 AC 降级。
  record = race.recordSubmission(record, pending, "2026-10-20T10:01:30Z");
  assert.strictEqual(record.events[0].resultKey, "AC");
  assert.strictEqual(record.participants[0].acceptedAt, "2026-10-20T10:01:00Z");
});

check("更早提交仍在判题时先等待，不提前宣布胜者", () => {
  let record = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice", "bob"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T10:10:00Z"
  });
  const bobPending = Object.assign(submission("s1", "bob", "Pending", "2026-10-20T10:01:00Z"), {
    resultCode: 6
  });
  record = race.recordSubmission(record, bobPending, "2026-10-20T10:01:10Z");
  record = race.recordSubmission(
    record,
    submission("s2", "alice", "AC", "2026-10-20T10:02:00Z"),
    "2026-10-20T10:02:10Z"
  );
  const waiting = race.evaluateRace(record, "2026-10-20T10:02:30Z");
  assert.strictEqual(waiting.status, "settling");
  assert.strictEqual(waiting.settling, true);
  assert.strictEqual(waiting.winner, null);

  // 更早的提交判为 AC 后，它才是胜者。
  record = race.recordSubmission(
    record,
    submission("s1", "bob", "AC", "2026-10-20T10:01:00Z"),
    "2026-10-20T10:02:40Z"
  );
  const resolved = race.evaluateRace(record, "2026-10-20T10:02:40Z");
  assert.strictEqual(resolved.status, "finished");
  assert.strictEqual(resolved.winner, "bob");
});

check("更早提交等待超时后按已确认结果结束；晚于首个 AC 的提交不阻塞", () => {
  let record = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice", "bob"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T10:10:00Z"
  });
  record = race.recordSubmission(
    record,
    Object.assign(submission("s1", "bob", "Pending", "2026-10-20T10:01:00Z"), { resultCode: 6 }),
    "2026-10-20T10:01:10Z"
  );
  record = race.recordSubmission(
    record,
    submission("s2", "alice", "AC", "2026-10-20T10:02:00Z"),
    "2026-10-20T10:02:10Z"
  );
  assert.strictEqual(
    race.evaluateRace(record, "2026-10-20T10:03:01Z").winner,
    "alice"
  );

  let later = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice", "bob"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T10:10:00Z"
  });
  later = race.recordSubmission(
    later,
    submission("s2", "alice", "AC", "2026-10-20T10:02:00Z"),
    "2026-10-20T10:02:10Z"
  );
  later = race.recordSubmission(
    later,
    Object.assign(submission("s3", "bob", "Judging", "2026-10-20T10:03:00Z"), { resultCode: 7 }),
    "2026-10-20T10:03:10Z"
  );
  const immediate = race.evaluateRace(later, "2026-10-20T10:03:20Z");
  assert.strictEqual(immediate.status, "finished");
  assert.strictEqual(immediate.winner, "alice");
});

check("最早 AC 获胜；未开始为 armed；无人 AC 到期结束", () => {
  let record = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice", "bob"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:10:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  assert.strictEqual(race.evaluateRace(record, "2026-10-20T10:05:00Z").status, "armed");
  record = race.recordSubmission(
    record,
    submission("s1", "bob", "AC", "2026-10-20T10:20:00Z"),
    "2026-10-20T10:20:10Z"
  );
  record = race.recordSubmission(
    record,
    submission("s2", "alice", "AC", "2026-10-20T10:15:00Z"),
    "2026-10-20T10:20:20Z"
  );
  const result = race.evaluateRace(record, "2026-10-20T10:30:00Z");
  assert.strictEqual(result.winner, "alice");
  const empty = race.createRaceRecord({
    problem: { displayId: "GW001" },
    participants: ["alice"],
    now: "2026-10-20T10:00:00Z",
    startAt: "2026-10-20T10:00:00Z",
    deadlineAt: "2026-10-20T11:00:00Z"
  });
  const expired = race.evaluateRace(empty, "2026-10-20T11:03:00Z");
  assert.strictEqual(expired.status, "finished");
  assert.strictEqual(expired.noWinner, true);
});

check("轮询退避与认证暂停", () => {
  assert.deepStrictEqual(race.nextPollDelay(0), { delayMs: 10000, paused: false });
  assert.deepStrictEqual(race.nextPollDelay(1), { delayMs: 20000, paused: false });
  assert.deepStrictEqual(race.nextPollDelay(3), { delayMs: 60000, paused: false });
  assert.deepStrictEqual(race.nextPollDelay(2, "auth"), { delayMs: 0, paused: true });
  assert.strictEqual(race.nextPollDelay(10).paused, true);
});

console.log(`problemset race OK（${passed} 项）`);
