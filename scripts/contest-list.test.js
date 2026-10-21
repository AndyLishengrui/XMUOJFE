/**
 * 实验列表隐藏记录：键归一化、隐藏/解除、过滤扫盘条目。
 */
"use strict";

const assert = require("assert");
const contestList = require("../src/contestList");

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

console.log("contest list");

check("键使用 baseUrl + 实验 id，忽略末尾斜杠", () => {
  assert.strictEqual(
    contestList.contestEntryKey({ key: "https://xmuoj.test::9", contest: { id: 9 } }),
    "https://xmuoj.test::9"
  );
  assert.strictEqual(
    contestList.contestEntryKey({ baseUrl: "https://xmuoj.test/", contest: { id: 12 } }),
    "https://xmuoj.test::12"
  );
  assert.strictEqual(
    contestList.contestEntryKey({ contest: { id: 12 } }, "https://xmuoj.test///"),
    "https://xmuoj.test::12"
  );
  assert.strictEqual(contestList.contestEntryKey({ contest: {} }), "");
  assert.strictEqual(contestList.contestEntryKey(null), "");
});

check("树节点（entry 嵌套）也能取到同一个键", () => {
  const entry = { key: "https://xmuoj.test::12", baseUrl: "https://xmuoj.test", contest: { id: 12, title: "实验" } };
  const treeItem = { entry, contest: entry.contest, baseUrl: entry.baseUrl };
  assert.strictEqual(
    contestList.contestEntryKey(treeItem, "https://xmuoj.test"),
    contestList.contestEntryKey(entry, "https://xmuoj.test")
  );
});

check("隐藏去重且可解除", () => {
  let hidden = [];
  hidden = contestList.hideContest(hidden, "a::1");
  hidden = contestList.hideContest(hidden, "a::2");
  hidden = contestList.hideContest(hidden, "a::1");
  assert.deepStrictEqual(hidden, ["a::2", "a::1"]);
  assert.strictEqual(contestList.isContestHidden(hidden, "a::1"), true);
  assert.strictEqual(contestList.isContestHidden(hidden, "a::3"), false);
  hidden = contestList.unhideContest(hidden, "a::1");
  assert.deepStrictEqual(hidden, ["a::2"]);
  assert.strictEqual(contestList.isContestHidden(hidden, "a::1"), false);
});

check("隐藏数量有上限，旧记录不会无限增长", () => {
  let hidden = [];
  for (let index = 0; index < contestList.MAX_HIDDEN_CONTESTS + 5; index += 1) {
    hidden = contestList.hideContest(hidden, `base::${index}`);
  }
  assert.strictEqual(hidden.length, contestList.MAX_HIDDEN_CONTESTS);
  assert.strictEqual(contestList.isContestHidden(hidden, "base::0"), false);
  assert.strictEqual(
    contestList.isContestHidden(hidden, `base::${contestList.MAX_HIDDEN_CONTESTS + 4}`),
    true
  );
});

check("过滤被隐藏的扫盘实验", () => {
  const entries = [
    { key: "https://xmuoj.test::483", contest: { id: 483 } },
    { key: "https://xmuoj.test::484", contest: { id: 484 } }
  ];
  const visible = contestList.filterHiddenEntries(entries, ["https://xmuoj.test::483"]);
  assert.deepStrictEqual(visible.map((entry) => entry.contest.id), [484]);
  assert.strictEqual(contestList.filterHiddenEntries(entries, []).length, 2);
});

console.log(`contest list OK（${passed} 项）`);
