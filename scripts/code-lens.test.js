/**
 * 编辑器 CodeLens 测试：录制入口必须显示为文字按钮，并随录制状态切换。
 */
"use strict";

const assert = require("assert");
const Module = require("module");

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
  }

  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
}

class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
  }
}

const vscode = {
  EventEmitter,
  CodeLens,
  Range: class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  },
  workspace: {
    getConfiguration: () => ({ get: () => [] })
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { XmuojCodeLensProvider } = require("../src/codeLens");
Module._load = originalLoad;

function documentAt(uriText) {
  return {
    fileName: uriText.replace(/^file:\/\//, ""),
    uri: { toString: () => uriText }
  };
}

function titles(lenses) {
  return lenses.map((lens) => lens.command && lens.command.title);
}

function commands(lenses) {
  return lenses.map((lens) => lens.command && lens.command.command);
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

console.log("code lens");

try {
  check("空闲时显示文字版开始录制入口", () => {
    const provider = new XmuojCodeLensProvider();
    const lenses = provider._capsuleLenses(documentAt("file:///tmp/main.cpp"), {});
    assert.deepStrictEqual(titles(lenses), ["开始录制时间胶囊"]);
    assert.deepStrictEqual(commands(lenses), ["xmuoj.timeCapsule.start"]);
  });

  check("录制中显示暂停与停止，且只出现在被录制的文档", () => {
    const provider = new XmuojCodeLensProvider();
    provider.setCapsuleState("recording", { documentUri: "file:///tmp/main.cpp" });
    const lenses = provider._capsuleLenses(documentAt("file:///tmp/main.cpp"), {});
    assert.deepStrictEqual(titles(lenses), ["暂停录制时间胶囊", "停止并保存时间胶囊"]);
    assert.deepStrictEqual(commands(lenses), ["xmuoj.timeCapsule.pause", "xmuoj.timeCapsule.stop"]);

    const other = provider._capsuleLenses(documentAt("file:///tmp/other.cpp"), {});
    assert.deepStrictEqual(other, [], "录制另一个文件时不应在本文档显示停止按钮");
  });

  check("暂停时显示继续，保存中不再显示录制入口", () => {
    const provider = new XmuojCodeLensProvider();
    provider.setCapsuleState("paused", { documentUri: "file:///tmp/main.cpp" });
    const paused = provider._capsuleLenses(documentAt("file:///tmp/main.cpp"), {});
    assert.deepStrictEqual(titles(paused), ["继续录制时间胶囊", "停止并保存时间胶囊"]);
    assert.deepStrictEqual(commands(paused), ["xmuoj.timeCapsule.resume", "xmuoj.timeCapsule.stop"]);

    provider.setCapsuleState("finalizing", null);
    assert.deepStrictEqual(provider._capsuleLenses(documentAt("file:///tmp/main.cpp"), {}), []);
  });

  check("状态变化时只触发必要的 CodeLens 刷新", () => {
    const provider = new XmuojCodeLensProvider();
    let refreshes = 0;
    provider.onDidChangeCodeLenses(() => {
      refreshes += 1;
    });
    provider.setCapsuleState("recording", { documentUri: "file:///tmp/main.cpp" });
    provider.setCapsuleState("recording", { documentUri: "file:///tmp/main.cpp" });
    provider.setCapsuleState("paused", { documentUri: "file:///tmp/main.cpp" });
    assert.strictEqual(refreshes, 2);
  });

  console.log(`code-lens OK（${passed} 项）`);
} catch (error) {
  console.error("CODE LENS FAILED：", error && error.stack ? error.stack : error);
  process.exit(1);
}
