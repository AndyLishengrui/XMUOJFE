/**
 * progress 单元测试：新进度键、旧键归并、实验上下文镜像、实验状态归一化。
 */
"use strict";

const assert = require("assert");

const progress = require("../src/progress");

const BASE_URL = "http://xmuoj.com";
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

console.log("progress");

check("进度键不再包含根目录", () => {
  const keyA = progress.buildProblemProgressKey(BASE_URL, 10220);
  const keyB = progress.buildProblemProgressKey(`${BASE_URL}/`, "10220");
  assert.strictEqual(keyA, "http://xmuoj.com::10220");
  assert.strictEqual(keyB, keyA);
  assert.ok(!keyA.includes("/Users/"));
  assert.strictEqual(progress.isLegacyProgressKey(keyA), false);
  assert.strictEqual(
    progress.isLegacyProgressKey(progress.buildLegacyProblemProgressKey(BASE_URL, 483, 10220, "/tmp/root")),
    true
  );
});

check("旧键归并：实验上下文进入 contests 子表", () => {
  const oldPublic = progress.buildLegacyProblemProgressKey(BASE_URL, null, 10220, "/root/A");
  const oldContest = progress.buildLegacyProblemProgressKey(BASE_URL, 483, 10220, "/root/A");
  const map = {
    [oldPublic]: {
      problemId: 10220,
      workspaceCreated: true,
      localPassed: true,
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    [oldContest]: {
      problemId: 10220,
      accepted: true,
      lastSubmissionLabel: "Accepted",
      updatedAt: "2026-02-01T00:00:00.000Z"
    }
  };
  const migrated = progress.migrateProgressMap(map);
  assert.strictEqual(migrated.changed, true);
  assert.strictEqual(migrated.migratedKeys.length, 2);
  const entry = migrated.progress["http://xmuoj.com::10220"];
  assert.ok(entry);
  assert.strictEqual(entry.accepted, true);
  assert.ok(entry.contests["483"]);
  assert.strictEqual(entry.contests["483"].accepted, true);
});

check("同题多实验旧键合并，不丢任一实验进度", () => {
  const map = {
    [progress.buildLegacyProblemProgressKey(BASE_URL, 483, 10220, "/root")]: {
      accepted: true,
      updatedAt: "2026-02-01T00:00:00.000Z"
    },
    [progress.buildLegacyProblemProgressKey(BASE_URL, 359, 10220, "/root")]: {
      lastSubmissionLabel: "Wrong Answer",
      updatedAt: "2026-03-01T00:00:00.000Z"
    }
  };
  const migrated = progress.migrateProgressMap(map);
  const entry = migrated.progress["http://xmuoj.com::10220"];
  assert.ok(entry.contests["483"]);
  assert.ok(entry.contests["359"]);
  assert.strictEqual(entry.contests["359"].lastSubmissionLabel, "Wrong Answer");
});

check("读取：新键优先，旧键回退，实验子表覆盖", () => {
  const ref = { baseUrl: BASE_URL, problemId: 10220, contestId: 483, progressScope: "/root" };
  const legacyKey = progress.buildLegacyProblemProgressKey(BASE_URL, 483, 10220, "/root");
  const value = progress.resolveProblemProgress({ [legacyKey]: { accepted: true, updatedAt: "2026-01-01T00:00:00.000Z" } }, ref);
  assert.strictEqual(value.accepted, true);

  const newKey = progress.buildProblemProgressKey(BASE_URL, 10220);
  const withScoped = progress.resolveProblemProgress(
    {
      [newKey]: {
        accepted: false,
        localPassed: true,
        updatedAt: "2026-02-01T00:00:00.000Z",
        contests: { 483: { accepted: true, lastSubmissionLabel: "Accepted" } }
      }
    },
    ref
  );
  assert.strictEqual(withScoped.accepted, true);
  assert.strictEqual(withScoped.localPassed, true);
  assert.strictEqual(withScoped.lastSubmissionLabel, "Accepted");
});

check("applyProgressPatch：镜像实验进度", () => {
  const ref = {
    key: progress.buildProblemProgressKey(BASE_URL, 10220),
    baseUrl: BASE_URL,
    problemId: 10220,
    displayId: "PTA1.1",
    title: "求2数的积",
    contestId: 483,
    contestTitle: "公共课 PTA 题库"
  };
  const first = progress.applyProgressPatch({}, ref, { workspaceCreated: true }, "2026-01-01T00:00:00.000Z");
  assert.strictEqual(first.entry.workspaceCreated, true);
  const second = progress.applyProgressPatch(first.progress, ref, { accepted: true }, "2026-02-01T00:00:00.000Z");
  assert.strictEqual(second.entry.workspaceCreated, true);
  assert.strictEqual(second.entry.accepted, true);
  assert.strictEqual(second.entry.contests["483"].accepted, true);
  assert.strictEqual(second.progress[ref.key].updatedAt, "2026-02-01T00:00:00.000Z");
});

check("进度摘要", () => {
  assert.strictEqual(progress.getProblemProgressSummary(null), "未开始");
  assert.strictEqual(progress.getProblemProgressSummary({ accepted: true }), "已 AC");
  assert.strictEqual(progress.getProblemProgressSummary({ lastSubmissionLabel: "WA" }), "已提交 · WA");
  assert.strictEqual(progress.getProblemProgressSummary({ localPassed: true }), "本地通过");
  assert.strictEqual(progress.getProblemProgressSummary({ workspaceCreated: true }), "已开题");
});

check("实验状态归一化", () => {
  assert.deepStrictEqual(progress.normalizeContestStatus("-1"), { key: "ended", label: "结束" });
  assert.deepStrictEqual(progress.normalizeContestStatus(0), { key: "running", label: "进行中" });
  assert.deepStrictEqual(progress.normalizeContestStatus("RUNNING"), { key: "running", label: "进行中" });
  assert.deepStrictEqual(progress.normalizeContestStatus("准备中"), { key: "pending", label: "准备中" });
  assert.strictEqual(progress.canContestSubmitRemotely({ status: "0" }), true);
  assert.strictEqual(progress.canContestSubmitRemotely({ status: "-1" }), false);
  assert.ok(progress.buildContestSubmitBlockedMessage({ status: "-1" }).includes("已结束"));
});

console.log(`progress OK（${passed} 项）`);
