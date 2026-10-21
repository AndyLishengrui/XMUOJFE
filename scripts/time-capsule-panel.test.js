/**
 * 回放面板纯逻辑测试：时间轴摘要、事件密度、切片协议、视频参数钳制、打开最终代码。
 * 不创建真实 webview，只验证扩展侧控制器发出的消息。
 */
"use strict";

const assert = require("assert");
const { TimeCapsulePanel, densityBuckets } = require("../src/timeCapsulePanel");

function makeVscode(configValues = {}) {
  const opened = [];
  const commandCalls = [];
  return {
    opened,
    commandCalls,
    ViewColumn: { Active: -1 },
    Uri: {
      joinPath: (...parts) => ({ fsPath: parts.map(String).join("/") })
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) =>
          Object.prototype.hasOwnProperty.call(configValues, key) ? configValues[key] : fallback
      }),
      openTextDocument: async (options) => {
        opened.push({ kind: "document", options });
        return { uri: { fsPath: "/tmp/opened" } };
      }
    },
    window: {
      showTextDocument: async (document, options) => {
        opened.push({ kind: "show", document, options });
      },
      showInformationMessage: () => undefined,
      showErrorMessage: () => undefined
    },
    commands: {
      executeCommand: async (id, arg) => {
        commandCalls.push({ id, arg });
      }
    }
  };
}

function makeHarness(configValues) {
  const vscode = makeVscode(configValues);
  const messages = [];
  const state = { disposed: false };
  const panel = {
    dispose: () => {
      state.disposed = true;
    },
    webview: {
      postMessage: async (message) => {
        messages.push(message);
        return true;
      }
    }
  };
  const controller = new TimeCapsulePanel({
    context: { extensionUri: {} },
    store: {},
    outputChannel: null,
    vscode
  });
  return { controller, panel, messages, vscode, state };
}

function makeCapsule(events, meta = {}) {
  return {
    meta: {
      id: "20261020T101500-ab12",
      language: "Python3",
      file: "main.py",
      durationMs: 400,
      ...meta
    },
    events
  };
}

async function main() {
  let passed = 0;
  const check = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  console.log("time capsule panel");

  await check("事件密度按时间分桶并钳制越界事件", () => {
    const events = [
      { t: 0 },
      { t: 249 },
      { t: 250 },
      { t: 999 },
      { t: 1000 },
      { t: 9999 },
      { t: -5 },
      { t: null },
      {},
      null
    ];
    assert.deepStrictEqual(densityBuckets(events, 1000, 4), [3, 1, 0, 3]);
    // duration 为 0 时按 1ms 处理，所有事件落入第一桶
    assert.deepStrictEqual(densityBuckets([{ t: 0 }, { t: 5 }], 0, 3), [1, 0, 1]);
    assert.deepStrictEqual(densityBuckets([], 1000, 3), [0, 0, 0]);
  });

  await check("时间轴摘要保留检查点、标记与时长", () => {
    const { controller } = makeHarness();
    const events = [
      { t: 0, k: "cp", text: "a" },
      { t: 100, k: "e", len: 1, c: [] },
      { t: 200, k: "m", name: "run", label: "本地测试", detail: { passed: 1, total: 2 } },
      { t: 300, k: "cp", text: "b" },
      { t: 400, k: "m", name: "submit", label: "Accepted" }
    ];
    const summary = controller._timelineSummary(makeCapsule(events));
    assert.strictEqual(summary.eventCount, 5);
    assert.strictEqual(summary.durationMs, 400);
    assert.deepStrictEqual(summary.checkpoints, [
      { index: 0, t: 0 },
      { index: 3, t: 300 }
    ]);
    assert.strictEqual(summary.markers.length, 2);
    assert.deepStrictEqual(summary.markers[0], {
      index: 2,
      t: 200,
      name: "run",
      label: "本地测试",
      detail: { passed: 1, total: 2 }
    });
    assert.strictEqual(summary.markers[1].label, "Accepted");
    assert.strictEqual(summary.density.length, 120);
    assert.strictEqual(summary.density.reduce((sum, value) => sum + value, 0), 5);
  });

  await check("缺少 meta 时长时回退到最后一个事件时间", () => {
    const { controller } = makeHarness();
    const summary = controller._timelineSummary(
      makeCapsule([{ t: 0, k: "cp", text: "" }, { t: 1250, k: "e", len: 0, c: [] }], { durationMs: 0 })
    );
    assert.strictEqual(summary.durationMs, 1250);
    assert.deepStrictEqual(controller._timelineSummary(makeCapsule([], { durationMs: 0 })), {
      eventCount: 0,
      durationMs: 0,
      checkpoints: [],
      markers: [],
      density: new Array(120).fill(0)
    });
  });

  await check("切片请求回显 requestId 并限制起点与数量", async () => {
    const { controller, panel, messages } = makeHarness();
    const events = Array.from({ length: 6000 }, (_value, index) => ({ t: index, k: "e", len: 0, c: [] }));
    const entry = { panel, capsule: makeCapsule(events, { durationMs: 5999 }) };

    await controller._handle(entry, { type: "events", start: 10, count: 999999, requestId: "r1" });
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, "capsule:events");
    assert.strictEqual(messages[0].requestId, "r1");
    assert.strictEqual(messages[0].start, 10);
    assert.strictEqual(messages[0].events.length, 5000);

    await controller._handle(entry, { type: "events", start: -20, count: 2, requestId: "r2" });
    assert.strictEqual(messages[1].start, 0);
    assert.deepStrictEqual(messages[1].events, events.slice(0, 2));

    await controller._handle(entry, { type: "events", start: 99999, count: 2, requestId: "r3" });
    assert.strictEqual(messages[2].start, 6000);
    assert.deepStrictEqual(messages[2].events, []);

    await controller._handle(entry, { type: "unknown" });
    assert.strictEqual(messages.length, 3);
  });

  await check("初始化消息下发时间轴与钳制后的视频参数", async () => {
    const { controller, panel, messages } = makeHarness({
      "timeCapsule.videoFps": 999,
      "timeCapsule.videoWidth": 100,
      "timeCapsule.videoHeight": 99999
    });
    const entry = { panel, capsule: makeCapsule([{ t: 0, k: "cp", text: "x" }]) };
    await controller._handle(entry, { type: "ready" });
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].type, "capsule:init");
    assert.strictEqual(messages[0].meta.file, "main.py");
    assert.strictEqual(messages[0].currentId, "20261020T101500-ab12");
    assert.strictEqual(messages[0].attempts.length, 1);
    assert.strictEqual(messages[0].attempts[0].attemptNumber, 1);
    assert.deepStrictEqual(messages[0].video, { fps: 60, width: 640, height: 2160 });

    const fallback = makeHarness();
    const fallbackEntry = { panel: fallback.panel, capsule: makeCapsule([{ t: 0, k: "cp", text: "x" }]) };
    await fallback.controller._handle(fallbackEntry, { type: "ready" });
    assert.deepStrictEqual(fallback.messages[0].video, { fps: 30, width: 1280, height: 720 });
  });

  await check("停止后的摘要会保留到页面确认已显示", async () => {
    const { controller, panel, messages } = makeHarness();
    const capsule = makeCapsule([{ t: 0, k: "cp", text: "x" }]);
    const entry = {
      panel,
      capsule,
      currentId: capsule.meta.id,
      preview: { durationMs: 125000, edits: 12, runs: 2, submits: 1, attempt: 3 }
    };
    controller._postInit(entry);
    assert.strictEqual(messages[0].preview.durationMs, 125000);
    assert.strictEqual(entry.preview.durationMs, 125000, "页面未确认前摘要应保留");

    await controller._handle(entry, { type: "ready" });
    assert.strictEqual(messages[1].preview.attempt, 3, "ready 后应再次下发摘要");
    assert.strictEqual(entry.preview.durationMs, 125000, "仅 ready 不应清空摘要");

    await controller._handle(entry, { type: "summaryShown", id: capsule.meta.id });
    assert.strictEqual(entry.preview, null, "页面确认显示后才清空");

    controller._postInit(entry);
    assert.strictEqual(messages[2].preview, null);
  });

  await check("初始化摘要始终可重建，关闭横幅后能再次查看", async () => {
    const { controller, panel, messages } = makeHarness();
    const capsule = makeCapsule([{ t: 0, k: "cp", text: "x" }], {
      attempt: 3,
      durationMs: 125000,
      result: "Accepted",
      eventCount: 44,
      startedAt: "2026-10-21T10:00:00.000Z",
      stats: { edits: 12, runs: 2, submits: 1 }
    });
    const entry = { panel, capsule, currentId: capsule.meta.id };
    controller._postInit(entry);
    assert.deepStrictEqual(messages[0].summary, {
      title: "录制摘要",
      durationMs: 125000,
      edits: 12,
      runs: 2,
      submits: 1,
      result: "Accepted",
      attempt: 3,
      language: "Python3",
      file: "main.py",
      startedAt: "2026-10-21T10:00:00.000Z",
      endedAt: "",
      eventCount: 44,
      path: ""
    });
    assert.strictEqual(messages[0].preview, null, "未停止录制时不自动弹出摘要");
  });

  await check("删除当前尝试：交给命令二次确认，导出中拒绝删除", async () => {
    const { controller, panel, messages, vscode } = makeHarness();
    const capsule = makeCapsule([{ t: 0, k: "cp", text: "x" }]);
    const entry = { panel, capsule, currentId: capsule.meta.id, video: null };
    await controller._handle(entry, { type: "deleteCapsule", id: capsule.meta.id });
    assert.deepStrictEqual(vscode.commandCalls, [
      { id: "xmuoj.timeCapsule.delete", arg: { id: capsule.meta.id } }
    ]);
    entry.video = { handle: {}, path: "/tmp/x", bytes: 0, queue: Promise.resolve(), failed: null };
    await controller._handle(entry, { type: "deleteCapsule", id: capsule.meta.id });
    assert.strictEqual(vscode.commandCalls.length, 1, "导出视频期间不触发删除");
    assert.ok(messages.some((message) => message.type === "capsule:error"));
  });

  await check("删除当前尝试后摘要清空，没有剩余尝试时关闭面板", async () => {
    const { controller, panel, state } = makeHarness();
    const capsule = makeCapsule([{ t: 0, k: "cp", text: "x" }]);
    const entry = {
      panel,
      capsule,
      currentId: capsule.meta.id,
      attempts: [{ id: capsule.meta.id }],
      preview: { durationMs: 1 }
    };
    controller.panels.set("problem-key", entry);
    await controller.removeCapsule(capsule.meta.id);
    assert.strictEqual(entry.preview, null, "已删除录制的摘要不能继续展示");
    assert.strictEqual(state.disposed, true, "没有剩余尝试时应关闭回放页");
  });

  await check("尝试列表缺少 attempts 时用当前胶囊兜底", () => {
    const { controller, panel } = makeHarness();
    const capsule = makeCapsule([{ t: 0, k: "cp", text: "x" }], { attempt: 4, stats: { edits: 2, runs: 1, submits: 0 } });
    const payload = controller._attemptsPayload({ panel, capsule, currentId: capsule.meta.id });
    assert.strictEqual(payload.length, 1);
    assert.strictEqual(payload[0].id, capsule.meta.id);
    assert.strictEqual(payload[0].attemptNumber, 4);
    assert.deepStrictEqual(payload[0].stats, { edits: 2, runs: 1, submits: 0 });
  });

  await check("打开最终代码使用最后一个检查点而非最后事件", async () => {
    const { controller, panel, vscode } = makeHarness();
    const entry = {
      panel,
      capsule: makeCapsule([
        { t: 0, k: "cp", text: "print(1)\n" },
        { t: 100, k: "e", len: 9, c: [] },
        { t: 200, k: "cp", text: "print(2)\n" }
      ])
    };
    await controller._handle(entry, { type: "openFinal" });
    assert.strictEqual(vscode.opened.length, 2);
    assert.deepStrictEqual(vscode.opened[0].options, { content: "print(2)\n", language: "python" });
    assert.deepStrictEqual(vscode.opened[1].options, { preview: false });
  });

  console.log(`time-capsule-panel OK（${passed} 项）`);
}

main().catch((error) => {
  console.error("TIME CAPSULE PANEL FAILED：", error && error.stack ? error.stack : error);
  process.exit(1);
});
