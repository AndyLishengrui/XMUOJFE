const vscode = require("vscode");

function isProblemColorizationEnabled() {
  return Boolean(vscode.workspace.getConfiguration("xmuoj").get("colorizeProblems", true));
}

function getProgressPresentation(progress) {
  if (!progress) {
    return { summary: "未开始", badge: "TODO", iconId: "circle-large-outline", colorId: "disabledForeground" };
  }
  if (progress.accepted) {
    return { summary: "已 AC", badge: "AC", iconId: "pass-filled", colorId: "testing.iconPassed" };
  }
  if (progress.lastSubmissionLabel) {
    return { summary: `已提交 · ${progress.lastSubmissionLabel}`, badge: "SUBMIT", iconId: "cloud-upload", colorId: "charts.blue" };
  }
  if (progress.localPassed) {
    return { summary: "本地通过", badge: "LOCAL", iconId: "beaker", colorId: "charts.green" };
  }
  if (progress.workspaceCreated) {
    return { summary: "已开题", badge: "DOING", iconId: "edit", colorId: "problemsWarningIcon.foreground" };
  }
  return { summary: "未开始", badge: "TODO", iconId: "circle-large-outline", colorId: "disabledForeground" };
}

class InfoTreeItem extends vscode.TreeItem {
  constructor(label, description) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = "info";
  }
}

class SectionTreeItem extends vscode.TreeItem {
  constructor(id, label, description) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = id;
    this.description = description;
    this.contextValue = "section";
  }
}

class ActionTreeItem extends vscode.TreeItem {
  constructor(label, description, command, argumentsList = []) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = "action";
    this.command = {
      command,
      title: label,
      arguments: argumentsList
    };
  }
}

class ProblemTreeItem extends vscode.TreeItem {
  constructor(problem, progress) {
    super(`${problem.display_id} ${problem.title}`, vscode.TreeItemCollapsibleState.None);
    this.problem = problem;
    const presentation = getProgressPresentation(progress);
    const parts = [];
    parts.push(presentation.badge);
    if (problem.difficulty) {
      parts.push(problem.difficulty);
    }
    this.description = parts.join(" · ");
    this.tooltip = `${problem.display_id} ${problem.title}\n状态：${presentation.summary}`;
    this.contextValue = "problem";
    this.iconPath = new vscode.ThemeIcon(
      presentation.iconId,
      isProblemColorizationEnabled() ? new vscode.ThemeColor(presentation.colorId) : undefined
    );
    this.command = {
      command: "xmuoj.openProblem",
      title: "打开题目",
      arguments: [problem]
    };
  }
}

class ProblemTreeDataProvider {
  constructor(state) {
    this.state = state;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      return this.getRootSections();
    }
    if (element instanceof SectionTreeItem) {
      return this.getSectionChildren(element.id);
    }
    return [];
  }

  getRootSections() {
    const sections = [
      new SectionTreeItem("quick", "快捷入口", this.state.user ? this.state.user.username : "未登录"),
      new SectionTreeItem("current", "当前作答", this.state.activeProblem ? this.state.activeProblem.display_id : "未选择题目")
    ];

    if ((this.state.recentProblems && this.state.recentProblems.length)
      || (this.state.recentContests && this.state.recentContests.length)
      || (this.state.submissionHistory && this.state.submissionHistory.length)) {
      sections.push(new SectionTreeItem("recent", "最近记录", `${(this.state.recentProblems || []).length} 题 / ${(this.state.recentContests || []).length} 场 / ${(this.state.submissionHistory || []).length} 提交`));
    }

    if (this.state.contestWorkspace) {
      sections.push(new SectionTreeItem("contest", "比赛题目", this.state.contestWorkspace.contest.title));
    }

    return sections;
  }

  getSectionChildren(sectionId) {
    if (sectionId === "quick") {
      return this.getQuickSectionChildren();
    }
    if (sectionId === "current") {
      return this.getCurrentSectionChildren();
    }
    if (sectionId === "recent") {
      return this.getRecentSectionChildren();
    }
    if (sectionId === "contest") {
      return this.getContestSectionChildren();
    }
    return [];
  }

  getQuickSectionChildren() {
    return [
      new ActionTreeItem("快速开始", "按步骤初始化插件", "xmuoj.quickStart"),
      new ActionTreeItem("浏览比赛", "搜索并打开比赛", "xmuoj.browseContests"),
      new ActionTreeItem("浏览题库", "搜索公开题目", "xmuoj.browseProblemset"),
      new ActionTreeItem("重新打开最近题目", "从最近记录恢复题目", "xmuoj.reopenRecentProblem"),
      new ActionTreeItem("打开结果面板", "查看本地测试、最近提交和提交历史", "xmuoj.showResultPanel")
    ];
  }

  getCurrentSectionChildren() {
    const items = [];
    if (this.state.user) {
      items.push(new InfoTreeItem("账号", this.state.user.username));
    }
    if (this.state.activeProblem) {
      const activeProgress = getProgressPresentation(this.getProblemProgress(this.state.activeProblem));
      items.push(new InfoTreeItem("当前题目", `${this.state.activeProblem.display_id} ${this.state.activeProblem.title} · ${activeProgress.badge}`));
      items.push(new ActionTreeItem("开始作答", "打开或恢复当前题目的本地代码文件", "xmuoj.startWorkingOnProblem"));
      items.push(new ActionTreeItem("查看题面", "重新打开当前题目题面", "xmuoj.showCurrentProblemDescription"));
      items.push(new ActionTreeItem("运行本地测试", "直接在当前题目上运行测试", "xmuoj.runLocalTests"));
      items.push(new ActionTreeItem("提交评测", "直接提交当前题目代码", "xmuoj.submitCurrentFile"));
    }
    if (this.state.lastLocalReport || this.state.lastSubmissionResult) {
      items.push(new ActionTreeItem("结果面板", "统一查看最近一次本地测试和在线提交", "xmuoj.showResultPanel"));
    }
    if (this.state.submissionHistory && this.state.submissionHistory.length) {
      items.push(new InfoTreeItem("提交历史", `最近 ${Math.min(this.state.submissionHistory.length, 20)} 条`));
    }
    if (this.state.lastLocalReport) {
      items.push(new InfoTreeItem("最近本地报告", `${this.state.lastLocalReport.passed}/${this.state.lastLocalReport.total} 通过`));
    }
    if (this.state.lastSubmissionResult) {
      items.push(new InfoTreeItem("最近提交", `${this.state.lastSubmissionResult.result_label} · #${this.state.lastSubmissionResult.id}`));
    }
    if (!this.state.activeProblem) {
      items.push(new InfoTreeItem("提示", "先从比赛或题库中选择一道题"));
    }
    return items;
  }

  getRecentSectionChildren() {
    const items = [];
    for (const item of this.state.recentProblems || []) {
      items.push(new ActionTreeItem(`${item.displayId} ${item.title}`, item.contestTitle || "题库", "xmuoj.reopenRecentProblemByItem", [item]));
    }
    for (const item of this.state.recentContests || []) {
      items.push(new ActionTreeItem(`比赛 ${item.id}`, item.title, "xmuoj.reopenRecentContestByItem", [item]));
    }
    for (const item of (this.state.submissionHistory || []).slice(0, 5)) {
      items.push(new ActionTreeItem(`提交 #${item.id}`, `${item.display_id || ""} ${item.title || ""} · ${item.result_label || ""}`, "xmuoj.openSubmissionHistoryEntry", [item]));
    }
    if (!items.length) {
      items.push(new InfoTreeItem("暂无记录", "打开过比赛或题目后会显示在这里"));
    }
    return items;
  }

  getContestSectionChildren() {
    const items = [
      new InfoTreeItem("当前比赛", this.state.contestWorkspace.contest.title),
      new ActionTreeItem("刷新比赛", "重新拉取当前比赛题目", "xmuoj.refreshContest"),
      new ActionTreeItem("批量生成比赛工作区", "为当前比赛的可见题目批量创建本地目录", "xmuoj.materializeContestWorkspace")
    ];
    const problems = this.state.contestWorkspace.problems || [];
    if (!problems.length) {
      return items;
    }
    return items.concat(problems.map((problem) => new ProblemTreeItem(problem, this.getProblemProgress(problem))));
  }

  getProblemProgress(problem) {
    const contest = this.state.contestWorkspace ? this.state.contestWorkspace.contest : null;
    const key = [this.state.baseUrl || "", contest ? contest.id : "problemset", problem.id].join("::");
    const progress = this.state.problemProgress ? this.state.problemProgress[key] : null;
    return progress || null;
  }
}

module.exports = {
  ProblemTreeDataProvider
};
