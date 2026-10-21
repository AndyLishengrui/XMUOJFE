/**
 * 时间胶囊格式层测试：补丁应用、检查点定位、按时间重建、停顿压缩、解析校验。
 */
"use strict";

const assert = require("assert");
const capsule = require("../media/shared/capsule-format");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("time capsule format");

check("多光标增量按偏移降序应用", () => {
  const result = capsule.applyChanges("abcdef", [
    { s: 1, e: 3, x: "XY" },
    { s: 4, e: 4, x: "!" }
  ]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.text, "aXYd!ef");
});

check("单次增量替换整段与插入", () => {
  assert.strictEqual(capsule.applyChanges("", [{ s: 0, e: 0, x: "hello" }]).text, "hello");
  assert.strictEqual(capsule.applyChanges("hello", [{ s: 0, e: 5, x: "" }]).text, "");
});

check("越界、重叠与非数字偏移被拒绝", () => {
  assert.strictEqual(capsule.applyChanges("abc", [{ s: 0, e: 9, x: "x" }]).ok, false);
  assert.strictEqual(capsule.applyChanges("abc", [{ s: 2, e: 2, x: "x" }, { s: 1, e: 3, x: "y" }]).ok, false);
  assert.strictEqual(capsule.applyChanges("abc", [{ s: "0", e: 0, x: "x" }]).ok, false);
});

check("事件长度校验失败时保留原文本", () => {
  const result = capsule.applyEvent({ text: "abc", cursor: { a: 3, b: 3 } }, {
    t: 10,
    k: "e",
    len: 2,
    c: [{ s: 0, e: 1, x: "A" }]
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.text, "abc");
});

check("光标事件夹紧到文本范围", () => {
  const result = capsule.applyEvent({ text: "abc", cursor: { a: 0, b: 0 } }, { t: 5, k: "cur", a: 9, b: 4 });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.cursor, { a: 3, b: 3 });
});

const events = [
  { t: 0, k: "cp", text: "" },
  { t: 100, k: "e", len: 0, c: [{ s: 0, e: 0, x: "int main" }] },
  { t: 200, k: "cur", a: 8, b: 8 },
  { t: 300, k: "e", len: 8, c: [{ s: 8, e: 8, x: "(){}" }] },
  { t: 400, k: "m", name: "run", label: "本地测试" },
  { t: 500, k: "cp", text: "int main(){}" },
  { t: 600, k: "e", len: 12, c: [{ s: 0, e: 12, x: "int main() { return 0; }" }] },
  { t: 700, k: "m", name: "submit", label: "提交" }
];

check("findCheckpoint 取目标时间之前最近的检查点", () => {
  assert.strictEqual(capsule.findCheckpoint(events, 450).index, 0);
  assert.strictEqual(capsule.findCheckpoint(events, 500).index, 5);
  assert.strictEqual(capsule.findCheckpoint(events, 999).index, 5);
});

check("sliceAt 重建任意时刻的文本与光标", () => {
  const early = capsule.sliceAt(events, 350);
  assert.strictEqual(early.text, "int main(){}");
  // 光标事件是节流上报的，文本变化本身不推断光标位置。
  assert.deepStrictEqual(early.cursor, { a: 8, b: 8 });
  const late = capsule.sliceAt(events, 650);
  assert.strictEqual(late.text, "int main() { return 0; }");
  assert.deepStrictEqual(late.markers.map((event) => event.name), ["run"]);
  assert.deepStrictEqual(capsule.sliceAt(events, 750).markers.map((event) => event.name), ["run", "submit"]);
});

check("sliceAt 没有检查点时从头重建", () => {
  const noCheckpoint = events.filter((event) => event.k !== "cp");
  const result = capsule.sliceAt(noCheckpoint, 250);
  assert.strictEqual(result.text, "int main");
  assert.strictEqual(result.checkpoint, null);
});

check("applyEventsTo 遇到损坏事件返回失败位置", () => {
  const result = capsule.applyEventsTo("abc", [{ t: 1, k: "e", len: 2, c: [] }]);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.failedAt, 0);
});

check("remapIdle 压缩长停顿并保留分段映射", () => {
  const remapped = capsule.remapIdle(
    [
      { t: 0, k: "cp", text: "" },
      { t: 1000, k: "cur", a: 0, b: 0 },
      { t: 60000, k: "m", name: "run" },
      { t: 61000, k: "cp", text: "" }
    ],
    { thresholdMs: 3000, compressedMs: 1000 }
  );
  assert.deepStrictEqual(remapped.events.map((event) => event.t), [0, 1000, 2000, 3000]);
  assert.strictEqual(remapped.durationMs, 3000);
  assert.strictEqual(remapped.realDurationMs, 61000);
  assert.strictEqual(remapped.segments.length, 1);
  assert.strictEqual(remapped.segments[0].idleMs, 59000);
});

check("validateCapsule 拒绝错误格式与版本", () => {
  assert.strictEqual(capsule.validateCapsule(null).ok, false);
  assert.strictEqual(
    capsule.validateCapsule({ format: "other", v: 1, id: "x", problem: {}, file: "a.cpp" }).ok,
    false
  );
  assert.strictEqual(
    capsule.validateCapsule({ format: capsule.FORMAT, v: 2, id: "x", problem: {}, file: "a.cpp" }).ok,
    false
  );
  assert.strictEqual(
    capsule.validateCapsule({ format: capsule.FORMAT, v: 1, id: "x", problem: {}, file: "a.cpp" }).ok,
    true
  );
});

check("parseCapsule 解析 NDJSON 并忽略崩溃留下的半行", () => {
  const meta = { format: capsule.FORMAT, v: 1, id: "cap1", problem: { id: 1 }, file: "main.cpp" };
  const text = `${JSON.stringify(meta)}\n${JSON.stringify({ t: 0, k: "cp", text: "" })}\n{"t": 5, "k": "e"`;
  const parsed = capsule.parseCapsule(text);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.events.length, 1);

  const broken = capsule.parseCapsule(`{oops}\n${JSON.stringify({ t: 0 })}`);
  assert.strictEqual(broken.ok, false);
});

console.log(`time capsule format OK（${passed} 项）`);
