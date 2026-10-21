/**
 * 公共题库队列纯函数测试。
 */
"use strict";

const assert = require("assert");
const queue = require("../src/problemsetQueue");

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

function problem(id, displayId) {
  return { id, display_id: displayId, title: `P${id}`, difficulty: "Low", languages: ["C++"] };
}

console.log("problemset queue");

check("新题追加到队尾并保持顺序", () => {
  let items = queue.upsertSelection([], problem(1, "A"), BASE);
  items = queue.upsertSelection(items, problem(2, "B"), BASE);
  items = queue.upsertSelection(items, problem(3, "C"), BASE);
  assert.deepStrictEqual(items.map((item) => item.id), [1, 2, 3]);
});

check("已存在的题原位更新，不改变顺序", () => {
  let items = [1, 2, 3].map((id) => problem(id, String(id)));
  items = queue.upsertSelection(items, Object.assign(problem(2, "2"), { title: "改过" }), BASE);
  assert.deepStrictEqual(items.map((item) => item.id), [1, 2, 3]);
  assert.strictEqual(items[1].title, "改过");
});

check("置顶真正移到第一位", () => {
  const items = [1, 2, 3].map((id) => problem(id, String(id)));
  const next = queue.moveSelectionToTop(items, problem(3, "3"), BASE);
  assert.deepStrictEqual(next.map((item) => item.id), [3, 1, 2]);
  assert.deepStrictEqual(items.map((item) => item.id), [1, 2, 3]);
});

check("游标：无游标取第一题", () => {
  const items = [1, 2, 3].map((id) => problem(id, String(id)));
  assert.strictEqual(queue.nextSelection(items, "", BASE).id, 1);
});

check("游标：中间取下一题，末尾回绕", () => {
  const items = [1, 2, 3].map((id) => problem(id, String(id)));
  const cursor = queue.buildCursor(items[0], BASE);
  assert.strictEqual(queue.nextSelection(items, cursor, BASE).id, 2);
  const last = queue.buildCursor(items[2], BASE);
  assert.strictEqual(queue.nextSelection(items, last, BASE).id, 1);
});

check("只有一题时重复返回该题", () => {
  const items = [problem(1, "1")];
  const cursor = queue.buildCursor(items[0], BASE);
  assert.strictEqual(queue.nextSelection(items, cursor, BASE).id, 1);
});

check("游标失效时回到第一题", () => {
  const items = [1, 2].map((id) => problem(id, String(id)));
  assert.strictEqual(queue.nextSelection(items, `${BASE}::999`, BASE).id, 1);
});

check("按站点过滤，baseUrl 归一化", () => {
  const items = [
    { id: 1, display_id: "1", baseUrl: `${BASE}/` },
    { id: 2, display_id: "2", baseUrl: "http://other.com" }
  ];
  assert.strictEqual(queue.filterSelections(items, BASE).length, 1);
  assert.strictEqual(queue.removeSelection(items, items[0], BASE).length, 1);
});

check("随机题限制在队列内", () => {
  const items = [1, 2, 3].map((id) => problem(id, String(id)));
  assert.strictEqual(queue.randomSelection(items, BASE, () => 0.99).id, 3);
  assert.strictEqual(queue.randomSelection([], BASE), null);
});

console.log(`problemset queue OK（${passed} 项）`);
