/**
 * 时间胶囊录制器测试：编辑/光标/暂停/标记/检查点/上限/放弃。
 * 用假时钟与假文档驱动，不依赖 vscode。
 */
"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const capsule = require("../media/shared/capsule-format");
const { TimeCapsuleStore } = require("../src/timeCapsuleStore");
const { TimeCapsuleRecorder } = require("../src/timeCapsuleRecorder");

function makeDocument(initialText, uriText) {
  let value = initialText;
  const uri = { toString: () => uriText || "file:///tmp/main.cpp" };
  return {
    uri,
    fileName: "/tmp/main.cpp",
    getText: () => value,
    replace(next) {
      const before = value;
      value = next;
      return { rangeOffset: 0, rangeLength: before.length, text: next };
    },
    set(next) {
      value = next;
    }
  };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-recorder-"));
  let clock = 1_000_000;
  const now = () => clock;
  const advance = (ms) => {
    clock += ms;
  };
  const store = new TimeCapsuleStore(root, { now: () => new Date(clock) });
  const problem = { id: 11, displayId: "GW001", title: "输出第二个整数" };

  let passed = 0;
  const check = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  console.log("time capsule recorder");

  try {
    await check("录制→编辑→暂停→标记→停止，时长不含暂停", async () => {
      const recorder = new TimeCapsuleRecorder({ store, now, cursorThrottleMs: 0 });
      const document = makeDocument("");
      const summary = await recorder.start({ document, problem, language: "Cpp", file: "main.cpp" });
      assert.strictEqual(summary.status, "recording");
      assert.strictEqual(summary.documentUri, "file:///tmp/main.cpp", "摘要应带上录制文档，供 CodeLens 定位");
      assert.strictEqual(recorder.summary().documentUri, "file:///tmp/main.cpp");

      advance(500);
      document.set("int main");
      recorder.handleTextChange({
        document,
        contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: "int main" }]
      });
      recorder.handleSelectionChange({
        textEditor: { document, selections: [{ anchor: { offset: 8 }, active: { offset: 8 } }] }
      });

      advance(1000);
      document.set("int main() {}");
      recorder.handleTextChange({
        document,
        contentChanges: [{ rangeOffset: 8, rangeLength: 0, text: "() {}" }]
      });
      recorder.mark("run", "本地测试", { passed: 1, total: 1 });
      recorder.mark("submit", "提交评测", { language: "Cpp" });
      recorder.mark("result", "Accepted", { accepted: true });

      advance(2000);
      assert.strictEqual(recorder.pause(), true);
      advance(10000);
      // 暂停期间的编辑不写入胶囊。
      document.set("should not be recorded");
      recorder.handleTextChange({
        document,
        contentChanges: [{ rangeOffset: 0, rangeLength: 18, text: "should not be recorded" }]
      });
      assert.strictEqual(recorder.resume(), true);
      advance(500);
      document.set("int main() { return 0; }");
      recorder.handleTextChange({
        document,
        contentChanges: [{ rangeOffset: 12, rangeLength: 0, text: " return 0; " }]
      });

      const stopped = await recorder.stop({ result: "accepted" });
      assert.strictEqual(stopped.meta.result, "accepted");
      assert.strictEqual(stopped.meta.durationMs, 4000);
      assert.strictEqual(stopped.edits, 3);
      assert.strictEqual(stopped.runs, 1);
      assert.strictEqual(stopped.submits, 1);

      const loaded = await store.read(stopped.meta.id);
      assert.deepStrictEqual(loaded.meta.stats, { edits: 3, runs: 1, submits: 1 });
      const final = capsule.sliceAt(loaded.events, Infinity);
      assert.strictEqual(final.text, "int main() { return 0; }");
      assert.deepStrictEqual(final.markers.map((event) => event.name), ["run", "submit", "result", "pause", "resume"]);
      const pauseMarker = loaded.events.find((event) => event.k === "m" && event.name === "pause");
      const resumeMarker = loaded.events.find((event) => event.k === "m" && event.name === "resume");
      assert.strictEqual(pauseMarker.t, 3500);
      assert.strictEqual(resumeMarker.t, 3500, "暂停区间不计入时间线");
      assert.strictEqual(loaded.meta.language, "Cpp");
    });

    await check("只录制目标文档，忽略其它文件", async () => {
      const recorder = new TimeCapsuleRecorder({ store, now, cursorThrottleMs: 0 });
      const document = makeDocument("", "file:///tmp/a.cpp");
      const other = makeDocument("", "file:///tmp/other.cpp");
      await recorder.start({ document, problem, language: "Cpp", file: "a.cpp" });
      recorder.handleTextChange({
        document: other,
        contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: "ignored" }]
      });
      const stopped = await recorder.stop({});
      const loaded = await store.read(stopped.meta.id);
      assert.strictEqual(loaded.events.some((event) => event.k === "e"), false);
    });

    await check("达到事件数量阈值时写入检查点", async () => {
      const recorder = new TimeCapsuleRecorder({ store, now, cursorThrottleMs: 0, checkpointEvents: 2 });
      const document = makeDocument("");
      await recorder.start({ document, problem, language: "Cpp", file: "main.cpp" });
      for (let i = 1; i <= 4; i += 1) {
        advance(10);
        document.set("x".repeat(i));
        recorder.handleTextChange({
          document,
          contentChanges: [{ rangeOffset: i - 1, rangeLength: 0, text: "x" }]
        });
      }
      const stopped = await recorder.stop({});
      const loaded = await store.read(stopped.meta.id);
      assert.ok(loaded.meta.checkpointCount >= 2, "应至少包含初始与阈值检查点");
      const final = capsule.sliceAt(loaded.events, Infinity);
      assert.strictEqual(final.text, "xxxx");
    });

    await check("达到存储上限时触发 onLimit 并停止", async () => {
      const limitedStore = new TimeCapsuleStore(root, { now: () => new Date(clock), maxBytes: 260 });
      let limitError = null;
      let stoppedFromHook = null;
      const recorder = new TimeCapsuleRecorder({
        store: limitedStore,
        now,
        cursorThrottleMs: 0,
        onLimit: async (error) => {
          limitError = error;
          stoppedFromHook = await recorder.stop({ result: "limit" });
        }
      });
      const document = makeDocument("");
      await recorder.start({ document, problem, language: "Cpp", file: "main.cpp" });
      advance(100);
      document.set("y".repeat(400));
      recorder.handleTextChange({
        document,
        contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: "y".repeat(400) }]
      });
      const deadline = Date.now() + 3000;
      while (!stoppedFromHook && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(limitError, "应触发上限回调");
      assert.strictEqual(limitError.code, "ELIMIT");
      assert.ok(stoppedFromHook, "上限回调应停止录制");
      assert.strictEqual(stoppedFromHook.result, "limit");
    });

    await check("放弃录制不生成胶囊", async () => {
      const recorder = new TimeCapsuleRecorder({ store, now, cursorThrottleMs: 0 });
      const document = makeDocument("abc");
      const started = await recorder.start({ document, problem, language: "Cpp", file: "main.cpp" });
      const before = (await store.recover()).map((entry) => entry.id);
      assert.ok(before.includes(started.id));
      assert.strictEqual(await recorder.discard(), true);
      const after = await store.list();
      assert.strictEqual(after.some((entry) => entry.id === started.id), false);
      assert.strictEqual((await store.recover()).some((entry) => entry.id === started.id), false);
    });

    await check("未开始时的操作安全返回", async () => {
      const recorder = new TimeCapsuleRecorder({ store, now });
      assert.strictEqual(await recorder.stop(), null);
      assert.strictEqual(await recorder.discard(), false);
      assert.strictEqual(recorder.pause(), false);
      assert.strictEqual(recorder.resume(), false);
      assert.strictEqual(recorder.summary().status, "idle");
    });

    await fs.rm(root, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => null);
    throw error;
  }

  console.log(`time capsule recorder OK（${passed} 项）`);
}

main().catch((error) => {
  console.error("time capsule recorder FAILED：", error && error.stack ? error.stack : error);
  process.exit(1);
});
