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
  replay: {
    title: "回放本题",
    command: "xmuoj.timeCapsule.replayProblem"
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
    this._capsule = { status: "idle", documentUri: "" };
  }

  setUser(_user) {
    this.refresh();
  }

  /** 把当前录制状态同步给 CodeLens；正常写代码时提供开始/暂停/停止入口。 */
  setCapsuleState(status, summary) {
    const next = {
      status: status || "idle",
      documentUri: (summary && summary.documentUri) || ""
    };
    const changed =
      next.status !== this._capsule.status || next.documentUri !== this._capsule.documentUri;
    this._capsule = next;
    if (changed) {
      this.refresh();
    }
  }

  _capsuleLenses(document, line) {
    const state = this._capsule || {};
    const active = state.status === "recording" || state.status === "paused";
    const documentId = document.uri && typeof document.uri.toString === "function"
      ? document.uri.toString()
      : "";
    if (active && state.documentUri) {
      const sameDocument = state.documentUri === documentId || state.documentUri === document.fileName;
      if (!sameDocument) {
        return [];
      }
      const lenses = [
        new vscode.CodeLens(line, {
          title: state.status === "paused" ? "继续录制时间胶囊" : "暂停录制时间胶囊",
          command: state.status === "paused" ? "xmuoj.timeCapsule.resume" : "xmuoj.timeCapsule.pause",
          arguments: []
        }),
        new vscode.CodeLens(line, {
          title: "停止并保存时间胶囊",
          command: "xmuoj.timeCapsule.stop",
          arguments: []
        })
      ];
      return lenses;
    }
    if (active || state.status === "finalizing") {
      return [];
    }
    return [
      new vscode.CodeLens(line, {
        title: "开始录制时间胶囊",
        command: "xmuoj.timeCapsule.start",
        arguments: []
      })
    ];
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
    const shortcutLenses = visibleShortcuts
      .map((key) => SHORTCUT_COMMANDS[key])
      .filter(Boolean)
      .map((item) => new vscode.CodeLens(line, {
        title: item.title,
        command: item.command,
        arguments: []
      }));
    // 录制入口放在最前面，避免只看到一个图标或埋在快捷键列表里。
    return this._capsuleLenses(document, line).concat(shortcutLenses);
  }
}

module.exports = {
  XmuojCodeLensProvider
};
