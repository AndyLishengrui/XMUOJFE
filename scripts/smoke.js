/**
 * 冒烟测试：mock vscode 模块后加载并激活扩展，验证
 * 1) 所有源模块可以正常 require（抓加载期错误）
 * 2) activate() 可以完整执行（抓激活期错误，如未定义引用）
 * 3) 命令注册数量符合预期
 * 不发起真实网络请求（fetch 被替换为失败桩，激活路径中的联网逻辑必须被 catch）。
 */
"use strict";

const path = require("path");
const Module = require("module");

const EXPECTED_MIN_COMMANDS = 40;

// ---- vscode mock ----------------------------------------------------------
class Disposable {
  constructor(callOnDispose) {
    this._call = typeof callOnDispose === "function" ? callOnDispose : null;
  }
  dispose() {
    if (this._call) {
      this._call();
    }
  }
}

class EventEmitter {
  constructor() {
    this._listeners = [];
  }
  event(listener) {
    this._listeners.push(listener);
    return new Disposable(() => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) {
        this._listeners.splice(idx, 1);
      }
    });
  }
  fire(event) {
    for (const listener of this._listeners.slice()) {
      listener(event);
    }
  }
  dispose() {
    this._listeners = [];
  }
}

const registeredCommands = [];

const mockOutputChannel = {
  append(value) {},
  appendLine(value) {},
  clear() {},
  show() {},
  hide() {},
  dispose() {}
};

const mockStatusBarItem = {
  text: "",
  tooltip: "",
  command: undefined,
  backgroundColor: undefined,
  priority: 0,
  show() {},
  hide() {},
  dispose() {}
};

const vscode = {
  version: "1.88.0",
  ViewColumn: { Active: -1, One: 1, Two: 2, Three: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  CodeLens: class CodeLens {
    constructor(range, command) {
      this.range = range;
      this.command = command;
    }
  },
  Range: class Range {
    constructor(startLine, startChar, endLine, endChar) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  },
  TreeItem: class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  ThemeIcon: class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
  },
  ThemeColor: class ThemeColor {
    constructor(id) {
      this.id = id;
    }
  },
  EventEmitter,
  Disposable,
  CancellationTokenSource: class CancellationTokenSource {
    constructor() {
      this.token = { isCancellationRequested: false, onCancellationRequested: () => new Disposable() };
    }
    cancel() {}
    dispose() {}
  },
  Uri: {
    file(p) {
      return { scheme: "file", fsPath: p, path: p, toString: () => `file://${p}` };
    },
    parse(s) {
      return { scheme: "vscode", fsPath: s, path: s, toString: () => String(s) };
    }
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => mockOutputChannel,
    createStatusBarItem: () => ({ ...mockStatusBarItem }),
    onDidChangeActiveTextEditor: () => new Disposable(),
    registerTreeDataProvider: () => new Disposable(),
    setStatusBarMessage: () => new Disposable(),
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showOpenDialog: async () => undefined,
    showTextDocument: async () => undefined,
    withProgress: (_options, task) => task({ report() {} }),
    createWebviewPanel: () => ({
      webview: { html: "", onDidReceiveMessage: () => new Disposable(), postMessage: async () => true },
      onDidDispose: () => new Disposable(),
      reveal() {},
      dispose() {}
    })
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (_key, defaultValue) => defaultValue,
      update: async () => {},
      inspect: () => ({ key: "", defaultValue: undefined, globalValue: undefined, workspaceValue: undefined })
    }),
    openTextDocument: async (target) => ({
      fileName: typeof target === "string" ? target : String(target),
      uri: vscode.Uri.file(typeof target === "string" ? target : String(target)),
      getText: () => "",
      languageId: "plaintext",
      isClosed: false
    }),
    saveAll: async () => true,
    onDidSaveTextDocument: () => new Disposable(),
    onDidChangeConfiguration: () => new Disposable(),
    fs: {
      readFile: async () => Buffer.alloc(0),
      writeFile: async () => undefined,
      stat: async () => ({ type: 1, size: 0 }),
      readdir: async () => []
    }
  },
  commands: {
    registerCommand: (id, callback) => {
      registeredCommands.push({ id, callback });
      return new Disposable(() => {
        const idx = registeredCommands.findIndex((entry) => entry.id === id);
        if (idx >= 0) {
          registeredCommands.splice(idx, 1);
        }
      });
    },
    executeCommand: async () => undefined
  },
  languages: {
    registerCodeLensProvider: () => new Disposable(),
    registerHoverProvider: () => new Disposable()
  },
  env: {
    appName: "Code",
    clipboard: { readText: async () => "", writeText: async () => undefined },
    openExternal: async () => true
  },
  lm: {
    selectChatModels: async () => []
  }
};

// ---- 拦截 require("vscode") ---------------------------------------------
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

// 激活路径中的联网调用必须被 catch；未捕获的 rejection 视为失败
const unhandledRejections = [];
process.on("unhandledRejection", (reason) => {
  unhandledRejections.push(reason);
});

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue),
    update: async (key, value) => {
      store.set(key, value);
      return undefined;
    },
    keys: async () => Array.from(store.keys())
  };
}

async function main() {
  // 在替换 fetch 的状态下加载，防止激活期发起真实网络请求
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("smoke test: network access is disabled");
  };

  try {
    const extension = require(path.join(__dirname, "..", "src", "extension.js"));
    if (typeof extension.activate !== "function" || typeof extension.deactivate !== "function") {
      throw new Error("扩展未正确导出 activate/deactivate");
    }

    const context = {
      subscriptions: [],
      globalState: makeStorage(),
      workspaceState: makeStorage(),
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined
      },
      extensionPath: path.join(__dirname, ".."),
      extensionMode: 1,
      asAbsolutePath: (p) => path.join(__dirname, "..", p)
    };

    const api = await extension.activate(context);
    void api;

    if (registeredCommands.length < EXPECTED_MIN_COMMANDS) {
      throw new Error(`命令注册数量异常：期望 >= ${EXPECTED_MIN_COMMANDS}，实际 ${registeredCommands.length}`);
    }
    const requiredCommands = ["xmuoj.login", "xmuoj.submitCurrentFile", "xmuoj.startWorkingOnProblem", "xmuoj.quickStart"];
    for (const id of requiredCommands) {
      if (!registeredCommands.some((entry) => entry.id === id)) {
        throw new Error(`缺少必需命令：${id}`);
      }
    }
    const activatedCommandCount = registeredCommands.length;

    // 事件回调（编辑器切换、命令执行入口）同步冒烟
    for (const { id, callback } of registeredCommands.slice()) {
      if (typeof callback !== "function") {
        throw new Error(`命令 ${id} 的回调不是函数`);
      }
    }

    extension.deactivate();
    for (const disposable of context.subscriptions) {
      try {
        disposable && disposable.dispose && disposable.dispose();
      } catch (_error) {
        /* dispose 失败不视为激活失败 */
      }
    }

    if (unhandledRejections.length) {
      const detail = unhandledRejections.map((reason) => (reason && reason.message) || String(reason)).join("; ");
      throw new Error(`存在未捕获的 Promise rejection：${detail}`);
    }

    console.log(`SMOKE OK：激活成功，注册命令 ${activatedCommandCount} 个`);
  } finally {
    globalThis.fetch = originalFetch;
    Module._load = originalLoad;
  }
}

main().catch((error) => {
  console.error("SMOKE FAILED：", error && error.stack ? error.stack : error);
  process.exit(1);
});
