/**
 * 题库目录合并、筛选、排序、统计测试。
 */
"use strict";

const assert = require("assert");
const catalog = require("../src/problemsetCatalog");

const BASE = "http://xmuoj.com";
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

function problem(id, displayId, extra = {}) {
  return Object.assign(
    {
      id,
      displayId,
      title: `题 ${displayId}`,
      difficulty: "Low",
      tags: [],
      acceptedNumber: 5,
      submissionNumber: 10,
      solvedOnServer: false,
      attemptedOnServer: false
    },
    extra
  );
}

console.log("problemset catalog");

check("本地进度按 id 与展示号匹配", () => {
  const index = catalog.buildLocalProgressIndex(
    {
      [`${BASE}::11`]: { problemId: 11, displayId: "GW001", workspaceCreated: true },
      [`${BASE}::12`]: { problemId: 12, displayId: "GW002", accepted: true }
    },
    BASE
  );
  assert.ok(catalog.findLocalProgress(index, problem(11, "GW001")));
  assert.strictEqual(catalog.findLocalProgress(index, problem(12, "GW002")).accepted, true);
  assert.strictEqual(catalog.findLocalProgress(index, problem(99, "GW099")), null);
});

check("服务端已 AC 优先，来源 server", () => {
  const merged = catalog.mergeCatalogWithLocal([problem(1, "A", { solvedOnServer: true })]);
  assert.strictEqual(merged[0].status, "solved");
  assert.strictEqual(merged[0].statusSource, "server");
});

check("本地 AC 但服务端未做：solved + conflict", () => {
  const localIndex = catalog.buildLocalProgressIndex(
    { [`${BASE}::1`]: { problemId: 1, displayId: "A", accepted: true } },
    BASE
  );
  const merged = catalog.mergeCatalogWithLocal([problem(1, "A")], { localIndex });
  assert.strictEqual(merged[0].status, "solved");
  assert.strictEqual(merged[0].statusSource, "local");
  assert.strictEqual(merged[0].conflict, true);
});

check("本地开题算 attempted，未做算 todo", () => {
  const localIndex = catalog.buildLocalProgressIndex(
    { [`${BASE}::1`]: { problemId: 1, displayId: "A", workspaceCreated: true } },
    BASE
  );
  const merged = catalog.mergeCatalogWithLocal([problem(1, "A"), problem(2, "B")], { localIndex });
  assert.strictEqual(merged[0].status, "attempted");
  assert.strictEqual(merged[1].status, "todo");
});

check("离线时状态全部来自本地并标注 local", () => {
  const localIndex = catalog.buildLocalProgressIndex(
    { [`${BASE}::1`]: { problemId: 1, displayId: "A", lastSubmissionLabel: "WA" } },
    BASE
  );
  const merged = catalog.mergeCatalogWithLocal([problem(1, "A")], {
    localIndex,
    serverAvailable: false
  });
  assert.strictEqual(merged[0].status, "attempted");
  assert.strictEqual(merged[0].statusSource, "local");
});

check("筛选：状态/难度/标签/关键词", () => {
  const list = [
    problem(1, "GW001", { tags: ["math"], difficulty: "Low", solvedOnServer: true }),
    problem(2, "GW002", { tags: ["dp"], difficulty: "Mid" }),
    problem(3, "GW010", { tags: ["dp"], difficulty: "High" })
  ];
  assert.strictEqual(catalog.applyFilters(list, { status: "solved" }).length, 1);
  assert.strictEqual(catalog.applyFilters(list, { status: "todo" }).length, 2);
  assert.strictEqual(catalog.applyFilters(list, { difficulty: "Mid" }).length, 1);
  assert.strictEqual(catalog.applyFilters(list, { tag: "dp" }).length, 2);
  assert.strictEqual(catalog.applyFilters(list, { keyword: "gw00" }).length, 2);
  assert.strictEqual(catalog.applyFilters(list, { keyword: "题 GW010" }).length, 1);
});

check("题号自然排序：GW2 在 GW10 前", () => {
  const list = [problem(3, "GW10"), problem(1, "GW2"), problem(2, "GW1")];
  const sorted = catalog.sortProblems(list, "default");
  assert.deepStrictEqual(sorted.map((item) => item.displayId), ["GW1", "GW2", "GW10"]);
});

check("按难度与提交数排序", () => {
  const list = [
    problem(1, "A", { difficulty: "High", submissionNumber: 1 }),
    problem(2, "B", { difficulty: "Low", submissionNumber: 9 }),
    problem(3, "C", { difficulty: "Mid", submissionNumber: 5 })
  ];
  assert.deepStrictEqual(
    catalog.sortProblems(list, "difficulty").map((item) => item.displayId),
    ["B", "C", "A"]
  );
  assert.deepStrictEqual(
    catalog.sortProblems(list, "submissions").map((item) => item.displayId),
    ["B", "C", "A"]
  );
});

check("统计：solved + attempted + todo = total", () => {
  const merged = catalog.mergeCatalogWithLocal([
    problem(1, "A", { solvedOnServer: true }),
    problem(2, "B", { attemptedOnServer: true }),
    problem(3, "C")
  ]);
  const stats = catalog.computeCatalogStats(merged);
  assert.strictEqual(stats.total, 3);
  assert.strictEqual(stats.solved, 1);
  assert.strictEqual(stats.attempted, 1);
  assert.strictEqual(stats.todo, 1);
  assert.strictEqual(stats.byDifficulty.Low.total, 3);
});

check("通过率与标签聚合", () => {
  const merged = catalog.mergeCatalogWithLocal([
    problem(1, "A", { acceptedNumber: 1, submissionNumber: 3, tags: ["math"] }),
    problem(2, "B", { acceptedNumber: 0, submissionNumber: 0, tags: ["math", "dp"] })
  ]);
  assert.strictEqual(merged[0].passRate, 33.3);
  assert.strictEqual(merged[1].passRate, null);
  const tags = catalog.computeTopTags(merged);
  assert.deepStrictEqual(tags[0], { name: "math", count: 2 });
});

check("分页边界", () => {
  const list = Array.from({ length: 120 }, (_, index) => problem(index + 1, `P${index + 1}`));
  const page = catalog.paginate(list, 3, 50);
  assert.strictEqual(page.totalPages, 3);
  assert.strictEqual(page.items.length, 20);
});

console.log(`problemset catalog OK（${passed} 项）`);
