/**
 * 全站排名索引与定位测试。
 */
"use strict";

const assert = require("assert");
const { buildRankIndex, locateRank, rankPercentile } = require("../src/problemsetRanking");

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

function row(username, accepted, score = 0) {
  return {
    username,
    acceptedNumber: accepted,
    submissionNumber: 0,
    totalScore: score
  };
}

console.log("problemset ranking");

const pages = [
  { offset: 0, total: 5, results: [row("a", 10), row("b", 9), row("c", 9)] },
  { offset: 3, total: 5, results: [row("d", 9), row("e", 8)] }
];
const index = buildRankIndex(pages);

check("索引包含全部页，名次连续", () => {
  assert.strictEqual(index.total, 5);
  assert.deepStrictEqual(index.rows.map((item) => item.position), [1, 2, 3, 4, 5]);
  assert.strictEqual(index.byUsername.get("e").position, 5);
});

check("定位自己：第一名", () => {
  const result = locateRank(index, "a");
  assert.strictEqual(result.status, "ranked");
  assert.strictEqual(result.rank, 1);
  assert.strictEqual(result.tieStart, 1);
  assert.strictEqual(result.tieEnd, 1);
});

check("并列区跨页：rank 取并列起点，position 是实际行", () => {
  const result = locateRank(index, "c");
  assert.strictEqual(result.status, "ranked");
  assert.strictEqual(result.rank, 2);
  assert.strictEqual(result.position, 3);
  assert.strictEqual(result.tieStart, 2);
  assert.strictEqual(result.tieEnd, 4);
});

check("最后一名与未找到", () => {
  assert.strictEqual(locateRank(index, "e").rank, 5);
  const missing = locateRank(index, "nobody");
  assert.strictEqual(missing.status, "not_found");
  assert.strictEqual(missing.rank, null);
});

check("AC 为 0 视为未上榜", () => {
  const zeroIndex = buildRankIndex([{ offset: 0, total: 1, results: [row("z", 0)] }]);
  assert.strictEqual(locateRank(zeroIndex, "z").status, "unranked");
});

check("OI 使用 total_score 定位并列", () => {
  const oiIndex = buildRankIndex(
    [
      {
        offset: 0,
        total: 3,
        results: [row("a", 1, 300), row("b", 2, 200), row("c", 3, 200)]
      }
    ],
    { rule: "oi" }
  );
  const result = locateRank(oiIndex, "c");
  assert.strictEqual(result.rank, 2);
  assert.strictEqual(result.tieEnd, 3);
});

check("百分位", () => {
  assert.strictEqual(rankPercentile(1, 100), 1);
  assert.strictEqual(rankPercentile(50, 100), 50);
  assert.strictEqual(rankPercentile(0, 0), null);
});

check("大小写不敏感的用户名查找", () => {
  assert.strictEqual(locateRank(index, "B").row.username, "b");
});

console.log(`problemset ranking OK（${passed} 项）`);
