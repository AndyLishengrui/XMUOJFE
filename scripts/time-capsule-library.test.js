/**
 * 时间胶囊题库索引测试：题目身份键、按题聚合、尝试排序与对比目标。
 * 这些函数是纯函数，不依赖文件系统或 vscode。
 */
"use strict";

const assert = require("assert");
const library = require("../src/timeCapsuleLibrary");

function entry(id, problem, startedAt, extra = {}) {
  return Object.assign({ id, problem, startedAt }, extra);
}

function main() {
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  console.log("time capsule library");

  check("题目键优先数字 id，其次展示号并转小写", () => {
    assert.strictEqual(library.problemKeyOf({ id: 11, displayId: "GW001" }), "id:11");
    assert.strictEqual(library.problemKeyOf({ problemId: "42", displayId: "gw001" }), "id:42");
    assert.strictEqual(library.problemKeyOf({ displayId: " GW001 " }), "display:gw001");
    assert.strictEqual(library.problemKeyOf({ display_id: "PTA1.1" }), "display:pta1.1");
    assert.strictEqual(library.problemKeyOf({}), "");
    assert.strictEqual(library.problemKeyOf(null), "");
  });

  check("索引条目优先使用已保存的 problemKey，兼容旧胶囊", () => {
    const legacy = entry("a", { id: 11, displayId: "GW001" }, "2026-10-20T10:00:00Z");
    assert.strictEqual(library.entryProblemKey(legacy), "id:11");
    assert.strictEqual(
      library.entryProblemKey({ problemKey: "display:gw001", problem: { id: 11 } }),
      "display:gw001"
    );
    assert.strictEqual(library.entryProblemKey(null), "");
  });

  check("同一道题的尝试按时间排序并标注序号，最新在前", () => {
    const entries = [
      entry("c", { displayId: "GW001" }, "2026-10-20T12:00:00Z", { attempt: 3 }),
      entry("a", { displayId: "GW001" }, "2026-10-20T10:00:00Z", { attempt: 1 }),
      entry("x", { displayId: "GW002" }, "2026-10-20T09:00:00Z", { attempt: 1 }),
      entry("b", { displayId: "GW001" }, "2026-10-20T11:00:00Z", { attempt: 2 })
    ];
    const attempts = library.attemptsForProblem(entries, { displayId: "gw001" });
    assert.deepStrictEqual(attempts.map((item) => item.id), ["c", "b", "a"]);
    assert.deepStrictEqual(attempts.map((item) => item.attemptNumber), [3, 2, 1]);
    assert.deepStrictEqual(library.attemptsForProblem(entries, {}), []);
  });

  check("旧胶囊没有 attempt 时按时间顺序补序号", () => {
    const entries = [
      entry("b", { id: 7 }, "2026-10-20T11:00:00Z"),
      entry("a", { id: 7 }, "2026-10-20T10:00:00Z")
    ];
    const attempts = library.attemptsForProblem(entries, { id: 7 });
    assert.deepStrictEqual(attempts.map((item) => item.id), ["b", "a"]);
    assert.deepStrictEqual(attempts.map((item) => item.attemptNumber), [2, 1]);
  });

  check("旧胶囊只有展示号时用展示号兜底，但数字 id 不同不合并", () => {
    const entries = [
      entry("legacy", { displayId: "GW001" }, "2026-10-20T10:00:00Z"),
      entry("current", { id: 11, displayId: "GW001" }, "2026-10-20T11:00:00Z"),
      entry("other", { id: 99, displayId: "GW001" }, "2026-10-20T12:00:00Z")
    ];
    const attempts = library.attemptsForProblem(entries, { id: 11, displayId: "GW001" });
    assert.deepStrictEqual(attempts.map((item) => item.id), ["current", "legacy"]);
  });

  check("对比目标优先更早一次，没有更早时退到更新一次", () => {
    const attempts = [{ id: "c" }, { id: "b" }, { id: "a" }];
    assert.strictEqual(library.compareTarget(attempts, "b").id, "a");
    assert.strictEqual(library.compareTarget(attempts, "a").id, "b");
    assert.strictEqual(library.compareTarget([{ id: "a" }], "a"), null);
    assert.strictEqual(library.compareTarget(attempts, "missing"), null);
  });

  check("最终代码取最后一个检查点", () => {
    const capsule = {
      events: [
        { t: 0, k: "cp", text: "a" },
        { t: 10, k: "e", len: 1, c: [] },
        { t: 20, k: "cp", text: "b" },
        { t: 30, k: "m", name: "run" }
      ]
    };
    assert.strictEqual(library.finalTextOf(capsule), "b");
    assert.strictEqual(library.finalTextOf({ events: [] }), "");
    assert.strictEqual(library.finalTextOf(null), "");
  });

  check("尝试标签兼容 attempt 与 attemptNumber", () => {
    assert.strictEqual(library.attemptLabel({ attemptNumber: 3 }), "第 3 次");
    assert.strictEqual(library.attemptLabel({ attempt: 2 }), "第 2 次");
    assert.strictEqual(library.attemptLabel({}), "一次尝试");
  });

  console.log(`time-capsule-library OK（${passed} 项）`);
}

main();
