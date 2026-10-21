/**
 * 站点 API 包装与归一化测试。
 */
"use strict";

const assert = require("assert");
const siteApi = require("../src/siteApi");

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

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

console.log("site api");

check("题目：数字主键与展示号分开", () => {
  const problem = siteApi.normalizeProblem({
    id: 11,
    _id: "GW001",
    title: "输出第二个整数",
    difficulty: "Low",
    tags: ["北大郭炜"],
    accepted_number: 1163,
    submission_number: 2070
  });
  assert.strictEqual(problem.id, 11);
  assert.strictEqual(problem.displayId, "GW001");
  assert.strictEqual(problem.acceptedNumber, 1163);
  assert.deepStrictEqual(problem.tags, ["北大郭炜"]);
});

check("题目：插件 problemset 的 display_id 也能识别", () => {
  const problem = siteApi.normalizeProblem({ id: 11, display_id: "GW001", title: "A" });
  assert.strictEqual(problem.displayId, "GW001");
});

check("题目：已归一化的 camelCase 字段再次归一化不会丢统计", () => {
  const problem = siteApi.normalizeProblem({
    id: 11,
    displayId: "GW001",
    title: "A",
    acceptedNumber: 1163,
    submissionNumber: 2070
  });
  assert.strictEqual(problem.acceptedNumber, 1163);
  assert.strictEqual(problem.submissionNumber, 2070);
});

check("profile：ACM/OI 状态表都合并，key 与 _id 都可匹配", () => {
  const profile = siteApi.normalizeProfile({
    username: "alice",
    accepted_number: 2,
    submission_number: 5,
    total_score: 300,
    acm_problems_status: {
      problems: {
        11: { _id: "GW001", status: 0 },
        12: { _id: "GW002", status: -1 }
      }
    },
    oi_problems_status: {
      problems: {
        "13": { _id: "GW003", status: 0 }
      }
    }
  });
  assert.strictEqual(profile.username, "alice");
  assert.strictEqual(profile.acceptedNumber, 2);
  assert.ok(profile.solvedSet.has("11"));
  assert.ok(profile.solvedSet.has("GW001"));
  assert.ok(profile.solvedSet.has("GW003"));
  assert.ok(profile.attemptedSet.has("GW002"));
  assert.ok(!profile.attemptedSet.has("GW001"));
});

check("提交：problem 是展示号，结果码映射", () => {
  const submission = siteApi.normalizeSubmission({
    id: "a1b2",
    problem: "GW001",
    result: 0,
    create_time: "2026-10-20T10:00:00",
    language: "C++",
    statistic_info: { time_cost: 12, memory_cost: 2048 }
  });
  assert.strictEqual(submission.problemDisplayId, "GW001");
  assert.strictEqual(submission.resultKey, "AC");
  assert.strictEqual(submission.createdAt, "2026-10-20T10:00:00.000Z");
  assert.strictEqual(submission.timeCost, 12);
  assert.strictEqual(submission.memoryCost, 2048);
});

check("提交：Pending/Judging/TLE 映射", () => {
  assert.strictEqual(siteApi.normalizeSubmission({ result: 6 }).resultKey, "Pending");
  assert.strictEqual(siteApi.normalizeSubmission({ result: 7 }).resultKey, "Judging");
  assert.strictEqual(siteApi.normalizeSubmission({ result: 1 }).resultKey, "TLE");
  assert.strictEqual(siteApi.normalizeSubmission({ result: 2 }).resultKey, "TLE");
});

check("时间解析：无时区补 Z，带时区保持", () => {
  assert.strictEqual(siteApi.parseServerTime("2026-10-20 10:00:00"), "2026-10-20T10:00:00.000Z");
  assert.strictEqual(siteApi.parseServerTime("2026-10-20T10:00:00+08:00"), "2026-10-20T02:00:00.000Z");
  assert.strictEqual(siteApi.parseServerTime(null), null);
});

check("排名行：名次按 offset + 下标", () => {
  const page = siteApi.normalizeRankPage(
    { total: 10, results: [{ user: { username: "a" }, accepted_number: 9 }] },
    2000
  );
  assert.strictEqual(page.results[0].rank, 2001);
  assert.strictEqual(page.total, 10);
});

async function main() {
  const calls = [];
  const client = {
    request: async (path) => {
      calls.push(path);
      if (path.includes("/api/profile?")) {
        return { username: "alice", accepted_number: 1, submission_number: 2, total_score: 100 };
      }
      if (path.includes("/api/problem?")) {
        const query = new URLSearchParams(path.split("?")[1]);
        const offset = Number(query.get("offset"));
        const total = 3;
        return {
          total,
          results: offset === 0
            ? [{ id: 1, _id: "A", title: "a" }, { id: 2, _id: "B", title: "b" }]
            : offset === 2
              ? [{ id: 3, _id: "C", title: "c" }]
              : []
        };
      }
      if (path.includes("/api/submissions?")) {
        return {
          total: 2,
          results: [
            { id: "s1", problem: "A", result: 0, create_time: "2026-10-20T10:00:00" },
            { id: "s2", problem: "B", result: -1, create_time: "2026-10-20T10:01:00" }
          ]
        };
      }
      if (path.includes("/api/user_rank?")) {
        const query = new URLSearchParams(path.split("?")[1]);
        const offset = Number(query.get("offset"));
        return {
          total: 3,
          results: offset === 0
            ? [{ user: { username: "a" }, accepted_number: 10 }, { user: { username: "b" }, accepted_number: 9 }]
            : offset === 2
              ? [{ user: { username: "c" }, accepted_number: 8 }]
              : []
        };
      }
      throw new Error(`unexpected path ${path}`);
    }
  };
  const api = siteApi.createSiteApi(client);

  await checkAsync("getAllProblems 翻页并去重", async () => {
    const result = await api.getAllProblems({ pageSize: 2 });
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.problems.length, 3);
    assert.deepStrictEqual(result.problems.map((item) => item.displayId), ["A", "B", "C"]);
  });

  await checkAsync("getAllSolvedSubmissions 按 AC 提交收集展示号", async () => {
    const result = await api.getAllSolvedSubmissions("alice", { pageSize: 2 });
    assert.deepStrictEqual(Array.from(result.solvedSet), ["A"]);
    assert.strictEqual(result.total, 2);
  });

  await checkAsync("getAllRank 拉满所有页", async () => {
    const result = await api.getAllRank({ pageSize: 2 });
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.pages.length, 2);
    assert.strictEqual(result.pages[1].results[0].username, "c");
  });

  await checkAsync("profile 与 submissions 走 request", async () => {
    const profile = await api.getProfile("alice");
    assert.strictEqual(profile.username, "alice");
    const page = await api.getSubmissions({ username: "alice", limit: 2 });
    assert.strictEqual(page.results.length, 2);
    assert.ok(calls.some((path) => path.includes("/api/profile?username=alice")));
    assert.ok(calls.some((path) => path.includes("/api/submissions?")));
  });

  console.log(`site api OK（${passed} 项）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
