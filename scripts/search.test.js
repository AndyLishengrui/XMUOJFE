/**
 * search 单元测试：本地过滤、在线并行检索的容错。
 */
"use strict";

const assert = require("assert");
const search = require("../src/search");

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok ${name}`);
    })
    .catch((error) => {
      console.error(`  FAIL ${name}`);
      throw error;
    });
}

async function main() {
  console.log("search");

  await check("本地过滤：题号、标题、实验名、大小写", () => {
    const entries = [
      { displayId: "PTA1.1", title: "求2数的积", contestTitle: "公共课 PTA 题库", problemId: 1 },
      { displayId: "JD004", title: "集市算账", contestTitle: "算法实验", problemId: 2 }
    ];
    assert.strictEqual(search.filterLocalWorkspaces(entries, "pta").length, 1);
    assert.strictEqual(search.filterLocalWorkspaces(entries, "算账")[0].problemId, 2);
    assert.strictEqual(search.filterLocalWorkspaces(entries, "算法实验")[0].problemId, 2);
    assert.strictEqual(search.filterLocalWorkspaces(entries, "2").length, 2);
    assert.strictEqual(search.filterLocalWorkspaces(entries, "").length, 2);
  });

  await check("collectLocalEntries 跳过无效条目并保留实验上下文", () => {
    const entries = search.collectLocalEntries({
      entries: {
        "http://xmuoj.com::1": { problemId: 1, displayId: "P1", title: "A", contestId: 9, contestTitle: "实验", updatedAt: "2026-01-01" },
        bad: { title: "无 id" }
      }
    });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].contestId, 9);
    assert.strictEqual(entries[0].displayId, "P1");
  });

  await check("在线搜索：一类失败不影响另一类", async () => {
    const client = {
      getProblemset: async () => ({ results: [{ id: 1 }] }),
      getContests: async () => {
        throw new Error("offline");
      }
    };
    const result = await search.searchOnline(client, "a");
    assert.strictEqual(result.problems.length, 1);
    assert.strictEqual(result.contests.length, 0);
    assert.ok(result.contestsError);
    assert.strictEqual(result.problemsError, null);
  });

  await check("在线搜索：两边都失败时返回空列表和错误", async () => {
    const client = {
      getProblemset: async () => {
        throw new Error("network");
      },
      getContests: async () => {
        throw new Error("network");
      }
    };
    const result = await search.searchOnline(client, "a");
    assert.deepStrictEqual(result.problems, []);
    assert.deepStrictEqual(result.contests, []);
    assert.ok(result.problemsError && result.contestsError);
  });

  console.log(`search OK（${passed} 项）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
