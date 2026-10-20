const vscode = require("vscode");

const { findProblemMetadata } = require("./problemWorkspace");

const SHORTCUT_COMMANDS = {
  start: {
    title: "打开代码",
    command: "xmuoj.startWorkingOnProblem"
  },
  test: {
    title: "运行本地测试",
    command: "xmuoj.runLocalTests"
  },
  submit: {
    title: "提交评测",
    command: "xmuoj.submitCurrentFile"
  },
  description: {
    title: "查看题面",
    command: "xmuoj.showCurrentProblemDescription"
  },
  results: {
    title: "查看结果报表",
    command: "xmuoj.showResultPanel"
  },
  language: {
    title: "切换代码语言",
    command: "xmuoj.switchProblemLanguage"
  },
  aiSolution: {
    title: "AI 解题",
    command: "xmuoj.generateAiSolution"
  },
  aiCode: {
    title: "AI 生成代码",
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
