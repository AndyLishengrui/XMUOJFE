const vscode = require("vscode");

const { findProblemMetadata } = require("./problemWorkspace");

const SHORTCUT_COMMANDS = {
  start: {
    title: "XMUOJ: 打开代码",
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
    title: "XMUOJ: 查看结果报表",
    command: "xmuoj.showResultPanel"
  },
  language: {
    title: "XMUOJ: 切换代码语言",
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
    this._onDidChangeCodeLenses = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  }

  setUser(_user) {
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
    const shortcuts = vscode.workspace.getConfiguration("xmuoj").get("editor.shortcuts") || ["start", "test", "submit", "description", "results"];
    const visibleShortcuts = (Array.isArray(shortcuts) ? shortcuts : []).filter((key) => key !== "aiSolution" && key !== "aiCode");
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
