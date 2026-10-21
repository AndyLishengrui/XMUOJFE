/**
 * 题库洞察纯函数测试：对手近期题目聚合与本题首 AC 榜。
 */
"use strict";

const assert = require("assert");
const {
  aggregateUserHistory,
  buildProblemLeaderboard
} = require("../src/problemsetInsights");

function submission({
  username = "bob",
  problem = "GW001",
  result = 0,
  at = "2026-10-20T10:00:00.000Z",
  title = "",
  language = "C++"
} = {}) {
  return {
    username,
    problemDisplayId: problem,
    problemTitle: title,
    resultCode: result,
    resultKey:
      result === 0 ? "AC" : result === -1 ? "WA" : result === 1 ? "TLE" : "Unknown",
    resultLabel: result === 0 ? "Accepted" : "Wrong Answer",
    createdAt: at,
    language
  };
}

function main() {
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  console.log("problemset insights");

  check("对手聚合：按题目统计提交次数、最早 AC 与最近状态", () => {
    const result = aggregateUserHistory([
      submission({ problem: "GW001", result: 0, at: "2026-10-20T10:05:00Z" }),
      submission({ problem: "GW001", result: -1, at: "2026-10-20T10:00:00Z" }),
      submission({ problem: "GW001", result: 0, at: "2026-10-20T09:50:00Z" }),
      submission({ problem: "GW002", result: -1, at: "2026-10-20T11:00:00Z" }),
      submission({ problem: "GW003", result: 0, at: "2026-10-20T08:00:00Z" })
    ]);
    assert.strictEqual(result.submissionCount, 5);
    assert.strictEqual(result.solvedCount, 2);
    assert.strictEqual(result.attemptedOnlyCount, 1);
    assert.deepStrictEqual(
      result.problems.map((row) => row.displayId),
      ["GW002", "GW001", "GW003"]
    );
    const gw001 = result.problems.find((row) => row.displayId === "GW001");
    assert.strictEqual(gw001.attempts, 3);
    assert.strictEqual(gw001.accepted, true);
    assert.strictEqual(gw001.acceptedAt, "2026-10-20T09:50:00Z");
    assert.strictEqual(gw001.latestAt, "2026-10-20T10:05:00Z");
    assert.strictEqual(gw001.latestResultKey, "AC");
    const gw002 = result.problems.find((row) => row.displayId === "GW002");
    assert.strictEqual(gw002.accepted, false);
    assert.strictEqual(gw002.latestResultKey, "WA");
  });

  check("对手聚合：忽略无题号记录与缺失时间", () => {
    const result = aggregateUserHistory([
      { username: "bob", resultKey: "AC" },
      submission({ problem: "GW001", at: null }),
      null
    ]);
    assert.strictEqual(result.submissionCount, 1);
    assert.strictEqual(result.problems.length, 1);
    assert.strictEqual(result.problems[0].latestAt, null);
    assert.strictEqual(result.problems[0].acceptedAt, null);
    assert.strictEqual(result.solvedCount, 1);
  });

  check("首 AC 榜：按最早 AC 时间排序并统计每人 AC 次数", () => {
    const board = buildProblemLeaderboard({
      acSubmissions: [
        submission({ username: "carol", at: "2026-10-20T10:03:00Z" }),
        submission({ username: "alice", at: "2026-10-20T10:01:00Z" }),
        submission({ username: "alice", at: "2026-10-20T10:05:00Z" }),
        submission({ username: "bob", at: "2026-10-20T10:02:00Z" }),
        submission({ username: "bob", at: "2026-10-20T10:00:00Z" }),
        submission({ username: "dave", result: -1, at: "2026-10-20T09:00:00Z" })
      ],
      recentSubmissions: [submission({ username: "carol" })],
      acTotal: 6,
      submissionTotal: 16,
      truncated: false
    });
    assert.deepStrictEqual(
      board.rows.map((row) => [row.rank, row.username, row.acceptedAt, row.acCount]),
      [
        [1, "bob", "2026-10-20T10:00:00Z", 2],
        [2, "alice", "2026-10-20T10:01:00Z", 2],
        [3, "carol", "2026-10-20T10:03:00Z", 1]
      ]
    );
    assert.strictEqual(board.uniqueAcceptedUsers, 3);
    assert.strictEqual(board.acTotal, 6);
    assert.strictEqual(board.passRate, 37.5);
    assert.strictEqual(board.recent.length, 1);
  });

  check("首 AC 榜：同时间按用户名稳定排序，无数据时通过率为空", () => {
    const board = buildProblemLeaderboard({
      acSubmissions: [
        submission({ username: "zoe", at: "2026-10-20T10:00:00Z" }),
        submission({ username: "amy", at: "2026-10-20T10:00:00Z" })
      ]
    });
    assert.deepStrictEqual(
      board.rows.map((row) => row.username),
      ["amy", "zoe"]
    );
    assert.strictEqual(board.passRate, null);
    assert.strictEqual(board.truncated, false);
  });

  check("最快通过：按首次提交→首次 AC 的用时排序，不受年份影响", () => {
    const board = buildProblemLeaderboard({
      submissions: [
        // 2021 年的同学：失败两次，40 分钟后 AC。
        submission({ username: "old", result: -1, at: "2021-03-01T08:00:00Z" }),
        submission({ username: "old", result: -1, at: "2021-03-01T08:20:00Z" }),
        submission({ username: "old", result: 0, at: "2021-03-01T08:40:00Z" }),
        // 2026 年的同学：一次通过，用时 0。
        submission({ username: "new", result: 0, at: "2026-10-20T10:00:00Z" }),
        // 用时 1 小时。
        submission({ username: "slow", result: -1, at: "2026-10-20T09:00:00Z" }),
        submission({ username: "slow", result: 0, at: "2026-10-20T10:00:00Z" })
      ],
      acTotal: 3,
      submissionTotal: 6
    });
    assert.strictEqual(board.speedAvailable, true);
    assert.deepStrictEqual(
      board.rows.map((row) => row.username),
      ["old", "new", "slow"],
      "首次 AC 榜仍是历史顺序"
    );
    assert.deepStrictEqual(
      board.fastest.map((row) => [row.username, row.durationMs, row.attempts]),
      [
        ["new", 0, 1],
        ["old", 2400000, 3],
        ["slow", 3600000, 2]
      ],
      "最快通过跨年份比较用时"
    );
    assert.deepStrictEqual(
      board.fastest.map((row) => row.rank),
      [1, 2, 3]
    );
    assert.deepStrictEqual(
      board.mostAccepted.map((row) => row.username),
      ["old", "new", "slow"],
      "AC 次数相同时按首次 AC 排序"
    );
  });

  check("最快通过：只有 AC 提交时用时不可用，不伪造 0", () => {
    const board = buildProblemLeaderboard({
      acSubmissions: [
        submission({ username: "bob", at: "2026-10-20T10:05:00Z" }),
        submission({ username: "amy", at: "2026-10-20T10:06:00Z" })
      ]
    });
    assert.strictEqual(board.speedAvailable, false);
    assert.deepStrictEqual(
      board.fastest.map((row) => row.durationMs),
      [null, null]
    );
    assert.strictEqual(board.rows[0].attempts, 1);
  });

  console.log(`problemset-insights OK（${passed} 项）`);
}

main();
