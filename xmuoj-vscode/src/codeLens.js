const vscode = require("vscode");

const { findProblemMetadata } = require("./problemWorkspace");

const ADMIN_TYPES = new Set(["Admin", "Super Admin"]);

function isAdminUser(user) {
  if (!user) {
    return false;
  }
  if (user.is_admin_role === true || user.isAdminRole === true) {
    return true;
  }
  return ADMIN_TYPES.has(user.admin_type) || ADMIN_TYPES.has(user.adminType);
}

const SHORTCUT_COMMANDS = {
  start: {
    title: "XMUOJ: 开始作答",
    command: "xmuoj.startWorkingOnProblem"
  },
  test: {
    title: "XMUOJ: 运行本地测试",
    command: "xmuoj.runLocalTests"
  },
  submit: {
    title: "XMUOJ: 提交评测",
    command: "xmuoj.submitCurrentFile"
  },
  description: {
    title: "XMUOJ: 查看题面",
    command: "xmuoj.showCurrentProblemDescription"
  },
  results: {
    title: "XMUOJ: 查看结果面板",
    command: "xmuoj.showResultPanel"
  },
  language: {
    title: "XMUOJ: 切换语言",
    command: "xmuoj.switchProblemLanguage"
  },
  aiSolution: {
    title: "XMUOJ: AI解题",
    command: "xmuoj.generateAiSolution"
  },
  aiCode: {
    title: "XMUOJ: AI代码",
    command: "xmuoj.generateAiCode"
  }
};

class XmuojCodeLensProvider {
  constructor() {
    this.user = null;
    this._onDidChangeCodeLenses = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  }

  setUser(user) {
    this.user = user || null;
    this.refresh();
  }

  refresh() {
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(document) {
    const metadataEntry = await findProblemMetadata(document.fileName);
    if (!metadataEntry || !metadataEntry.metadata) {
      return [];
    }
    const shortcuts = vscode.workspace.getConfiguration("xmuoj").get("editor.shortcuts") || ["start", "test", "submit", "description", "results", "aiSolution", "aiCode"];
    const visibleShortcuts = isAdminUser(this.user)
      ? shortcuts
      : shortcuts.filter((key) => key !== "aiSolution" && key !== "aiCode");
    const line = new vscode.Range(0, 0, 0, 0);
    return visibleShortcuts
      .map((key) => SHORTCUT_COMMANDS[key])
      .filter(Boolean)
      .map((item) => new vscode.CodeLens(line, {
        title: item.title,
        command: item.command,
        arguments: []
      }));
  }
}

module.exports = {
  XmuojCodeLensProvider
};