/**
 * 本地集成测试：在临时目录里模拟真实工作区，走完整链路
 *
 * 1. 旧布局（contest-* / problemsets）+ 新布局 problems/ 混合启动
 * 2. 激活扩展 → 启动扫盘 → 自动迁移 → 索引重建
 * 3. 校验目录、元数据 v2、备份、索引
 * 4. 校验侧边栏三组结构与「我的实验」扫盘分组
 * 5. 校验统一搜索的本地过滤、在线失败降级、接受本地结果后写入最近题目
 * 6. 校验回滚命令与再次迁移命令
 *
 * 不访问网络：fetch 被替换为失败桩。
 */
"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const Module = require("module");

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

class MockQuickPick {
  constructor() {
    this.title = "";
    this.placeholder = "";
    this.matchOnDescription = false;
    this.matchOnDetail = false;
    this.ignoreFocusOut = false;
    this.items = [];
    this.value = "";
    this.selectedItems = [];
    this.visible = false;
    this._valueEmitter = new EventEmitter();
    this._acceptEmitter = new EventEmitter();
    this._buttonEmitter = new EventEmitter();
    this._hideEmitter = new EventEmitter();
  }
  onDidChangeValue(listener) {
    return this._valueEmitter.event(listener);
  }
  onDidAccept(listener) {
    return this._acceptEmitter.event(listener);
  }
  onDidTriggerItemButton(listener) {
    return this._buttonEmitter.event(listener);
  }
  onDidHide(listener) {
    return this._hideEmitter.event(listener);
  }
  show() {
    this.visible = true;
  }
  hide() {
    if (!this.visible) {
      return;
    }
    this.visible = false;
    this._hideEmitter.fire();
  }
  dispose() {}
}

const createdQuickPicks = [];
const registeredCommands = new Map();
const registeredTreeProviders = new Map();
const infoMessages = [];
let programmaticConfig = {};
let warningResponder = () => undefined;

const mockOutputChannel = {
  append() {},
  appendLine() {},
  clear() {},
  show() {},
  hide() {},
  dispose() {}
};

function makeStatusBarItem() {
  return {
    text: "",
    tooltip: "",
    command: undefined,
    backgroundColor: undefined,
    priority: 0,
    show() {},
    hide() {},
    dispose() {}
  };
}

const vscode = {
  version: "1.88.0",
  ViewColumn: { Active: -1, One: 1, Two: 2, Three: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
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
    constructor(id, color) {
      this.id = id;
      this.color = color;
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
    visibleTextEditors: [],
    createOutputChannel: () => mockOutputChannel,
    createStatusBarItem: () => makeStatusBarItem(),
    createQuickPick: () => {
      const pick = new MockQuickPick();
      createdQuickPicks.push(pick);
      return pick;
    },
    onDidChangeActiveTextEditor: () => new Disposable(),
    registerTreeDataProvider: (id, provider) => {
      registeredTreeProviders.set(id, provider);
      return new Disposable(() => registeredTreeProviders.delete(id));
    },
    setStatusBarMessage: () => new Disposable(),
    showInformationMessage: async (message) => {
      infoMessages.push(message);
      return undefined;
    },
    showErrorMessage: async (message) => {
      infoMessages.push(message);
      return undefined;
    },
    showWarningMessage: async (message, ...rest) => {
      infoMessages.push(message);
      return warningResponder(message, ...rest);
    },
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showOpenDialog: async () => undefined,
    showTextDocument: async () => undefined,
    withProgress: (_options, task) => task({ report() {} }, {
      isCancellationRequested: false,
      onCancellationRequested: () => new Disposable()
    }),
    createWebviewPanel: () => ({
      title: "",
      webview: {
        html: "",
        cspSource: "",
        asWebviewUri: (uri) => uri,
        onDidReceiveMessage: () => new Disposable(),
        postMessage: async () => true
      },
      onDidDispose: () => new Disposable(),
      reveal() {},
      dispose() {}
    })
  },
  workspace: {
    workspaceFolders: undefined,
    textDocuments: [],
    getConfiguration: () => ({
      get: (key, defaultValue) => (key in programmaticConfig ? programmaticConfig[key] : defaultValue),
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
      registeredCommands.set(id, callback);
      return new Disposable(() => registeredCommands.delete(id));
    },
    executeCommand: async (id, ...args) => {
      const callback = registeredCommands.get(id);
      if (callback) {
        return callback(...args);
      }
      return undefined;
    }
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
    selectChatModels: async () => [],
    LanguageModelChatMessage: { User: (...args) => ({ role: "user", content: args }) }
  }
};

const originalLoad = Module._load;
const stubUndici = {
  Agent: class Agent {
    close() {
      return Promise.resolve();
    }
  },
  fetch: async () => {
    throw new Error("local integration test: network disabled");
  }
};
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  // client.js 优先使用 undici.fetch；只替换 globalThis.fetch 不足以断网。
  if (request === "node:undici" || request === "undici") {
    return stubUndici;
  }
  return originalLoad.call(this, request, parent, isMain);
};

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

// ---- helpers --------------------------------------------------------------

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listProblemDirs(root) {
  const problemsDir = path.join(root, "problems");
  let entries = [];
  try {
    entries = await fs.readdir(problemsDir, { withFileTypes: true });
  } catch (_error) {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(problemsDir, entry.name));
}

async function findProblemDirById(root, problemId) {
  for (const dir of await listProblemDirs(root)) {
    try {
      const metadata = JSON.parse(await fs.readFile(path.join(dir, ".xmuoj.json"), "utf8"));
      if (Number(metadata.problemId) === Number(problemId)) {
        return dir;
      }
    } catch (_error) {
      /* 忽略无元数据目录 */
    }
  }
  return null;
}

async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 50, label = "条件" } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`等待超时：${label}`);
}

function findItem(items, predicate) {
  return (items || []).find((item) => predicate(item));
}

function localItems(items) {
  return (items || []).filter((item) => item && item.payload && item.payload.type === "local");
}

// ---- test body ------------------------------------------------------------

async function main() {
  console.log("local-integration");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-local-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("local integration test: network disabled");
  };

  try {
    // 新布局：已在 problems/ 下的题目（v1 元数据，激活时升级为 v2）
    await writeJson(path.join(root, "problems", "PTA1.1-求2数的积", ".xmuoj.json"), {
      version: 1,
      problemId: 10220,
      displayId: "PTA1.1",
      title: "求2数的积",
      language: "Python3",
      sourceFile: "main.py",
      contestId: 483,
      contestTitle: "公共课 PTA 题库",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    await writeFile(path.join(root, "problems", "PTA1.1-求2数的积", "main.py"), "print(1)\n");

    // 旧布局：contest-<id> 下的实验题
    await writeJson(path.join(root, "contest-483", "JD001-数组求和", ".xmuoj.json"), {
      version: 1,
      problemId: 10221,
      displayId: "JD001",
      title: "数组求和",
      language: "Cpp",
      sourceFile: "main.cpp",
      contestTitle: "公共课 PTA 题库",
      createdAt: "2026-09-02T00:00:00.000Z"
    });
    await writeFile(path.join(root, "contest-483", "JD001-数组求和", "main.cpp"), "int main(){return 0;}\n");
    await writeFile(path.join(root, "contest-483", "JD001-数组求和", "problem.md"), "# 数组求和\n");

    // 旧布局：public problemsets 下的题
    await writeJson(path.join(root, "problemsets", "JD004-集市算账", ".xmuoj.json"), {
      version: 1,
      problemId: 10222,
      displayId: "JD004",
      title: "集市算账",
      language: "Python3",
      sourceFile: "main.py",
      createdAt: "2026-09-03T00:00:00.000Z"
    });
    await writeFile(path.join(root, "problemsets", "JD004-集市算账", "main.py"), "print(2)\n");

    // 新布局：目录名带 shell 危险字符（!），运行按钮会失败，应能一键修复
    await writeJson(path.join(root, "problems", "PTA7.3-求-1!+2!+3!+...+n!", ".xmuoj.json"), {
      version: 1,
      problemId: 10223,
      displayId: "PTA7.3",
      title: "求 1!+2!+3!+...+n!",
      language: "Python3",
      sourceFile: "main.py",
      createdAt: "2026-09-04T00:00:00.000Z"
    });
    await writeFile(path.join(root, "problems", "PTA7.3-求-1!+2!+3!+...+n!", "main.py"), "print(4)\n");

    // 无元数据的旧目录：必须原样保留
    await writeFile(path.join(root, "contest-359", "无元数据", "main.py"), "print(3)\n");

    programmaticConfig = {
      localWorkspaceRoot: root,
      enableSideMode: true,
      colorizeProblems: true,
      autoMigrate: true,
      rememberContestPasswords: false,
      "editor.shortcuts": ["start", "test", "submit"]
    };
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(root), name: path.basename(root), index: 0 }];

    const extension = require(path.join(__dirname, "..", "src", "extension.js"));
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

    await extension.activate(context);

    // 1) 启动扫盘 + 自动迁移
    await waitFor(async () => {
      const movedContest = await findProblemDirById(root, 10221);
      const movedPublic = await findProblemDirById(root, 10222);
      return Boolean(movedContest && movedPublic);
    }, { label: "自动迁移完成" });

    const contestDir = await findProblemDirById(root, 10221);
    const publicDir = await findProblemDirById(root, 10222);
    assert.ok(contestDir.startsWith(path.join(root, "problems") + path.sep), "实验题应迁入 problems/");
    assert.ok(publicDir.startsWith(path.join(root, "problems") + path.sep), "公共题应迁入 problems/");
    assert.strictEqual(await exists(path.join(root, "contest-483")), false, "空的 contest-483 应被清理");
    assert.strictEqual(await exists(path.join(root, "problemsets")), false, "空的 problemsets 应被清理");
    assert.strictEqual(await exists(path.join(root, "contest-359", "无元数据", "main.py")), true, "无元数据目录必须保留");
    assert.strictEqual(await exists(path.join(contestDir, "main.cpp")), true, "源码文件必须随目录移动");
    assert.strictEqual(await exists(path.join(contestDir, "problem.md")), true, "题面文件必须随目录移动");
    console.log("  ok 启动扫盘 + 自动迁移：实验题/公共题迁入 problems/，无元数据目录保留");

    const movedMetadata = JSON.parse(await fs.readFile(path.join(contestDir, ".xmuoj.json"), "utf8"));
    assert.strictEqual(movedMetadata.version, 2, "迁移后元数据应升级为 v2");
    assert.strictEqual(movedMetadata.identity, "http://xmuoj.com::10221");
    assert.strictEqual(Number(movedMetadata.contestId), 483);
    assert.strictEqual(movedMetadata.contestTitle, "公共课 PTA 题库");
    assert.strictEqual(movedMetadata.sourceFiles.Cpp, "main.cpp");
    assert.strictEqual(movedMetadata.createdAt, "2026-09-02T00:00:00.000Z");
    assert.strictEqual(await exists(path.join(root, ".xmuoj", "backup-v1", "10221.json")), true, "应保留 v1 元数据备份");
    console.log("  ok 元数据升级 v2：身份/实验信息/源码映射保留，v1 已备份");

    const index = JSON.parse(await fs.readFile(path.join(root, ".xmuoj", "index.json"), "utf8"));
    assert.strictEqual(Object.keys(index.entries).length, 4, "索引应包含 4 道题");
    for (const entry of Object.values(index.entries)) {
      assert.ok(String(entry.dir).startsWith("problems/"), `索引目录应指向 problems/：${entry.dir}`);
    }
    console.log("  ok 索引重建：4 道题全部指向 problems/");

    // 2) 侧边栏结构
    const treeProvider = registeredTreeProviders.get("xmuojExplorer");
    assert.ok(treeProvider, "应注册刷题工作台 TreeDataProvider");
    const sections = await treeProvider.getChildren();
    assert.deepStrictEqual(sections.map((item) => item.label), ["最近在做", "我的实验", "公共题库"]);
    console.log("  ok 工作台顶层只有三组");

    const contestsSection = sections.find((item) => item.id === "contests");
    const contestChildren = await treeProvider.getChildren(contestsSection);
    const scannedContest = findItem(contestChildren, (item) => item.contextValue === "contestWorkspace" && Number(item.contest.id) === 483);
    assert.ok(scannedContest, "扫盘得到的实验 483 应出现在「我的实验」");
    assert.strictEqual(scannedContest.label, "公共课 PTA 题库");
    assert.strictEqual(scannedContest.entry.scanned, true);
    const contestProblems = await treeProvider.getChildren(scannedContest);
    assert.strictEqual(contestProblems.length, 2, "实验 483 展开应有 2 道题");
    assert.deepStrictEqual(
      contestProblems.map((item) => item.problem.display_id).sort(),
      ["JD001", "PTA1.1"]
    );
    console.log("  ok 扫盘实验分组：展开直接是 2 道题目");

    const recentSection = sections.find((item) => item.id === "recent");
    const recentChildren = await treeProvider.getChildren(recentSection);
    assert.ok(findItem(recentChildren, (item) => item.command && item.command.command === "xmuoj.search"), "最近为空时应提供搜索入口");

    // 3) 统一搜索
    await vscode.commands.executeCommand("xmuoj.search");
    const quickPick = createdQuickPicks[0];
    assert.ok(quickPick, "搜索应创建 QuickPick");
    assert.strictEqual(localItems(quickPick.items).length, 4, "空关键词应列出 4 道本地题目");

    quickPick.value = "算账";
    quickPick._valueEmitter.fire("算账");
    let filtered = localItems(quickPick.items);
    assert.strictEqual(filtered.length, 1, "本地过滤应立即只剩 1 道题");
    assert.ok(filtered[0].label.includes("集市算账"));

    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.strictEqual(localItems(quickPick.items).length, 1, "在线失败后本地结果仍保留");
    assert.ok(
      findItem(quickPick.items, (item) => String(item.label).includes("在线搜索暂不可用")),
      "离线时应显示在线搜索降级提示"
    );
    console.log("  ok 统一搜索：本地即时过滤 + 在线失败降级");

    quickPick.selectedItems = [filtered[0]];
    await quickPick._acceptEmitter.fire();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const recent = context.globalState.get("xmuoj.recentProblems", []);
    assert.strictEqual(recent.length, 1, "接受本地结果后应写入最近题目");
    assert.strictEqual(Number(recent[0].problemId), 10222);
    assert.strictEqual(recent[0].displayId, "JD004");
    quickPick.hide();
    console.log("  ok 搜索接受本地结果：写入「最近在做」");

    // 4) 修复 shell 危险目录名
    warningResponder = (message) => (String(message).includes("题目目录名包含") ? "开始修复" : undefined);
    await vscode.commands.executeCommand("xmuoj.fixProblemDirectoryNames");
    const fixedDir = path.join(root, "problems", "PTA7.3-求-1！+2！+3！+...+n！");
    assert.strictEqual(await exists(path.join(fixedDir, "main.py")), true, "改名后源码应保留");
    assert.strictEqual(await exists(path.join(root, "problems", "PTA7.3-求-1!+2!+3!+...+n!")), false, "原目录应消失");
    const fixedIndex = JSON.parse(await fs.readFile(path.join(root, ".xmuoj", "index.json"), "utf8"));
    assert.ok(
      Object.values(fixedIndex.entries).some((entry) => String(entry.dir).includes("！")),
      "索引应指向改名后的目录"
    );
    console.log("  ok 修复题目目录名：! 替换为全角！，索引同步");

    // 5) 回滚与再次迁移
    warningResponder = (message) => (String(message).includes("移回原目录") ? "回滚迁移" : undefined);
    await vscode.commands.executeCommand("xmuoj.rollbackWorkspaceMigration");
    assert.strictEqual(await exists(path.join(root, "contest-483", "JD001-数组求和", "main.cpp")), true, "回滚后实验题应回到 contest-483");
    assert.strictEqual(await exists(path.join(root, "problemsets", "JD004-集市算账", "main.py")), true, "回滚后公共题应回到 problemsets");
    assert.strictEqual(await findProblemDirById(root, 10221), null, "回滚后 problems/ 不应再有实验题");
    console.log("  ok 回滚命令：目录与源码恢复旧布局");

    warningResponder = (message) => (String(message).includes("迁移到 problems") ? "开始迁移" : undefined);
    await vscode.commands.executeCommand("xmuoj.migrateWorkspaces");
    assert.ok(await findProblemDirById(root, 10221), "再次迁移后实验题应回到 problems/");
    assert.ok(await findProblemDirById(root, 10222), "再次迁移后公共题应回到 problems/");
    console.log("  ok 迁移命令：回滚后可再次迁移");

    // 6) 重建索引
    infoMessages.length = 0;
    await vscode.commands.executeCommand("xmuoj.rebuildWorkspaceIndex");
    assert.ok(infoMessages.some((message) => String(message).includes("共 4 道题")), "重建索引应报告 4 道题");
    console.log("  ok 重建索引命令");

    extension.deactivate();
    for (const disposable of context.subscriptions) {
      try {
        disposable && disposable.dispose && disposable.dispose();
      } catch (_error) {
        /* 忽略 dispose 失败 */
      }
    }

    assert.strictEqual(unhandledRejections.length, 0, `存在未捕获 rejection：${unhandledRejections.map((reason) => (reason && reason.message) || reason).join("; ")}`);

    console.log("local-integration OK（12 项）");
  } finally {
    globalThis.fetch = originalFetch;
    Module._load = originalLoad;
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("local-integration FAILED：", error && error.stack ? error.stack : error);
    process.exit(1);
  });
