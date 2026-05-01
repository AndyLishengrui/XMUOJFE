const fs = require("fs/promises");
const path = require("path");
const vscode = require("vscode");

const { findExistingProblemWorkspace } = require("./problemWorkspace");


function isProblemColorizationEnabled() {
  return Boolean(vscode.workspace.getConfiguration("xmuoj").get("colorizeProblems", true));
}

function makeThemeIcon(iconId, colorId) {
  return new vscode.ThemeIcon(
    iconId,
    colorId ? new vscode.ThemeColor(colorId) : undefined
  );
}

function getActionIcon(command) {
  const mapping = {
    "xmuoj.quickStart": "rocket",
    "xmuoj.login": "account",
    "xmuoj.logout": "sign-out",
    "xmuoj.browseContests": "search",
    "xmuoj.browseProblemset": "book",
    "xmuoj.openProblemsetProblem": "book",
    "xmuoj.manageProblemsetSelections": "trash",
    "xmuoj.openContestWorkspaceByItem": "repo",
    "xmuoj.openContestWorkspaceProblem": "note",
    "xmuoj.manageContestWorkspaceSelections": "trash",
    "xmuoj.showResultPanel": "graph",
    "xmuoj.startWorkingOnProblem": "play",
    "xmuoj.showCurrentProblemDescription": "eye",
    "xmuoj.runLocalTests": "beaker",
    "xmuoj.submitCurrentFile": "cloud-upload",
    "xmuoj.refreshContest": "refresh",
    "xmuoj.materializeContestWorkspace": "files",
    "xmuoj.openSubmissionHistoryEntry": "graph",
    "xmuoj.revealContestWorkspace": "link-external",
    "xmuoj.revealProblemsetWorkspace": "link-external",
    "xmuoj.removeContestWorkspaceSelection": "close",
    "xmuoj.initContestWorkspace": "new-folder"
  };
  return makeThemeIcon(mapping[command] || "chevron-right");
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
  constructor(label, description, iconId = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = description ? `${label}\n${description}` : label;
    this.contextValue = "info";
    this.iconPath = makeThemeIcon(iconId, "descriptionForeground");
  }
}

class SectionTreeItem extends vscode.TreeItem {
  constructor(id, label, description, iconId = "chevron-right") {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = id;
    this.description = description;
    this.contextValue = "section";
    this.iconPath = makeThemeIcon(iconId);
  }
}

class GroupTreeItem extends vscode.TreeItem {
  constructor(id, label, description, iconId = "list-unordered", collapsed = false, contextValue = "group") {
    super(label, collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
    this.id = id;
    this.description = description;
    this.contextValue = contextValue;
    this.iconPath = makeThemeIcon(iconId, "descriptionForeground");
  }
}

class ActionTreeItem extends vscode.TreeItem {
  constructor(label, description, command, argumentsList = [], options = {}) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = options.showDescription ? description : undefined;
    this.tooltip = description ? `${label}\n${description}` : label;
    this.contextValue = "action";
    this.command = {
      command,
      title: label,
      arguments: argumentsList
    };
    this.iconPath = getActionIcon(command);
  }
}

class ProblemTreeItem extends vscode.TreeItem {
  constructor(problem, progress, command = "xmuoj.openProblem", argumentsList = [problem], contextValue = "problem", options = {}) {
    super(`${problem.display_id} ${problem.title}`, options.collapsible === false ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed);
    this.problem = problem;
    this.baseUrl = options.baseUrl;
    this.contest = options.contest || null;
    const presentation = getProgressPresentation(progress);
    this.description = presentation.summary;
    this.tooltip = `${problem.display_id} ${problem.title}\n状态：${presentation.summary}${problem.difficulty ? `\n难度：${problem.difficulty}` : ""}`;
    this.contextValue = contextValue;
    this.iconPath = new vscode.ThemeIcon(
      presentation.iconId,
      isProblemColorizationEnabled() ? new vscode.ThemeColor(presentation.colorId) : undefined
    );
    this.command = {
      command,
      title: "打开题目",
      arguments: argumentsList
    };
  }
}

class WorkspaceEntryTreeItem extends vscode.TreeItem {
  constructor(entry, rootDir, activeFilePath) {
    super(entry.name, entry.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.entry = entry;
    this.rootDir = rootDir;
    this.isActive = !entry.isDirectory && activeFilePath && path.resolve(entry.fullPath) === path.resolve(activeFilePath);
    this.contextValue = entry.isDirectory ? "problemWorkspaceFolder" : "problemWorkspaceFile";
    this.tooltip = entry.fullPath;
    this.description = this.isActive ? "当前编辑" : (path.relative(rootDir, entry.fullPath) || ".");
    this.iconPath = this.isActive
      ? makeThemeIcon("edit", "charts.green")
      : makeThemeIcon(entry.isDirectory ? "folder" : "file");
    if (!entry.isDirectory) {
      this.resourceUri = vscode.Uri.file(entry.fullPath);
      this.command = {
        command: "vscode.open",
        title: "打开文件",
        arguments: [vscode.Uri.file(entry.fullPath)]
      };
    }
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
    if (element instanceof GroupTreeItem) {
      return this.getGroupChildren(element.id);
    }
    if (element instanceof ProblemTreeItem) {
      return this.getProblemWorkspaceChildren(element);
    }
    if (element instanceof WorkspaceEntryTreeItem) {
      return this.getWorkspaceEntryChildren(element);
    }
    return [];
  }

  getRootSections() {
    const sections = [
      new SectionTreeItem("quick", "设置", undefined, this.state.user ? "home" : "account"),
      new SectionTreeItem("contests", "实验题库", this.state.openContestWorkspaces && this.state.openContestWorkspaces.length ? `${this.state.openContestWorkspaces.length} 场` : undefined, "repo"),
      new SectionTreeItem("problemset", "公共题库", this.state.problemsetSelections && this.state.problemsetSelections.length ? `${this.state.problemsetSelections.length} 道` : undefined, "book")
    ];

    return sections;
  }

  getSectionChildren(sectionId) {
    if (sectionId === "quick") {
      return this.getQuickSectionChildren();
    }
    if (sectionId === "problemset") {
      return this.getProblemsetSectionChildren();
    }
    if (sectionId === "contests") {
      return this.getContestsSectionChildren();
    }
    return [];
  }

  getQuickSectionChildren() {
    const items = [];
    if (this.state.user) {
      items.push(new InfoTreeItem("账户设置", this.state.user.username, "account"));
      items.push(new ActionTreeItem("退出账号", "清除当前 XMUOJ 登录状态", "xmuoj.logout"));
    } else {
      items.push(new ActionTreeItem("登入账号", "登录后再开始刷题", "xmuoj.login"));
    }
    return items;
  }

  getProblemsetSectionChildren() {
    const items = [
      new ActionTreeItem("加载题目", "搜索公开题目并加入下面的题目列表", "xmuoj.browseProblemset"),
      new ActionTreeItem("打开题目目录", "在本地工作区根目录下打开 problemsets 文件夹", "xmuoj.revealProblemsetWorkspace")
    ];
    if (this.state.problemsetSelections && this.state.problemsetSelections.length) {
      items.push(new ActionTreeItem("删除题目", "从已添加题目中移除一题，或直接清空", "xmuoj.manageProblemsetSelections"));
      items.push(new GroupTreeItem("problemset-selected", "题目列表", `${this.state.problemsetSelections.length} 道`, "list-unordered", false));
      return items;
    }
    items.push(new InfoTreeItem("暂无题目", "先点「加载题目」把公开题目加入这里，之后就能刷公共题库", "list-unordered"));
    return items;
  }

  getContestsSectionChildren() {
    const items = [
      new ActionTreeItem("加载实验", "搜索实验并把实验加入下面的实验列表", "xmuoj.browseContests")
    ];
    if (this.state.openContestWorkspaces && this.state.openContestWorkspaces.length) {
      return items.concat(this.state.openContestWorkspaces.map((item) => new GroupTreeItem(`contest-workspace::${item.key}`, item.contest.title, `${(item.problems || []).length} 题`, "repo", true, "contestWorkspace")));
    }
    items.push(new InfoTreeItem("暂无实验", "先点「加载实验」加载一场实验，下面才会出现实验列表", "repo"));
    return items;
  }

  getCurrentSectionChildren() {
    const items = [];
    if (this.state.activeProblem) {
      items.push(new InfoTreeItem("当前题", `${this.state.activeProblem.display_id} ${this.state.activeProblem.title}`, "note"));
      items.push(new ActionTreeItem("编写代码", "创建并打开代码文件", "xmuoj.startWorkingOnProblem"));
      items.push(new ActionTreeItem("提交评测", "提交当前题目代码", "xmuoj.submitCurrentFile"));
    }
    if (!this.state.activeProblem) {
      items.push(new InfoTreeItem("提示", "先从「公共题库」或「实验题库」打开一道题，再开始作答", "lightbulb"));
    }
    return items;
  }

  getSubmissionProblemGroups() {
    const groups = new Map();
    for (const item of this.state.submissionHistory || []) {
      const key = [item.baseUrl || "", item.contestId || "", item.problemId || item.display_id || "", item.title || ""].join("::");
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(item);
    }
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }

  getVisibleSubmissionProblemGroups() {
    const groups = this.getSubmissionProblemGroups().map(({ key, items }) => ({
      key,
      items: items.filter((item) => this.matchesSubmissionResultFilter(item) && this.matchesSubmissionLanguageFilter(item))
    })).filter(({ items }) => items.length > 0);
    if (this.state.recentSubmissionScope !== "current") {
      return groups;
    }
    if (!this.state.activeProblem || !this.state.activeProblem.id) {
      return [];
    }
    return groups.filter(({ items }) => {
      const latest = items[0];
      return String(latest.problemId || "") === String(this.state.activeProblem.id)
        && String(latest.contestId || "") === String(this.state.activeContest ? this.state.activeContest.id : "")
        && String(latest.baseUrl || this.state.baseUrl || "") === String(this.state.baseUrl || "");
    });
  }

  matchesSubmissionResultFilter(item) {
    const filter = this.state.recentSubmissionResultFilter || "all";
    const label = String(item && item.result_label ? item.result_label : "");
    if (filter === "all") {
      return true;
    }
    if (filter === "non-ac") {
      return label !== "Accepted" && label !== "AC";
    }
    if (filter === "errors-only") {
      return ["Compile Error", "CE", "Runtime Error", "RE", "System Error", "SE", "Memory Limit Exceeded", "MLE", "Time Limit Exceeded", "TLE"].includes(label);
    }
    return true;
  }

  matchesSubmissionLanguageFilter(item) {
    const filter = this.state.recentSubmissionLanguageFilter || "all";
    if (filter === "all") {
      return true;
    }
    return String(item && item.language ? item.language : "") === String(filter);
  }

  getGroupChildren(groupId) {
    if (groupId === "problemset-selected") {
      return (this.state.problemsetSelections || []).map((item) => new ProblemTreeItem(
        item,
        this.getProblemProgress(item, null, item.baseUrl),
        "xmuoj.openProblemsetProblem",
        [item],
        "problemsetSelection",
        { baseUrl: item.baseUrl }
      ));
    }
    if (groupId.startsWith("contest-workspace::")) {
      const targetKey = groupId.replace("contest-workspace::", "");
      const entry = (this.state.openContestWorkspaces || []).find((item) => item.key === targetKey);
      if (!entry) {
        return [];
      }
      return [
        new ActionTreeItem("打开实验目录", "在本地工作区根目录下打开 contest-<实验编号> 文件夹", "xmuoj.revealContestWorkspace", [entry]),
        new ActionTreeItem("批量创建题目目录", "为实验下所有题目创建 problem.md、.xmuoj.json 和样例文件（不含代码）", "xmuoj.initContestWorkspace"),
        new ActionTreeItem("刷新实验", "根据实验目录里面的代码状态更新题目列表", "xmuoj.refreshContest"),
        new ActionTreeItem("删除实验", "把这场实验从实验列表中移除", "xmuoj.removeContestWorkspaceSelection", [entry]),  
        new GroupTreeItem(`contest-workspace-problems::${entry.key}`, "题目列表", `${(entry.problems || []).length} 道`, "list-unordered", false)
      ];
    }
    if (groupId.startsWith("contest-workspace-problems::")) {
      const targetKey = groupId.replace("contest-workspace-problems::", "");
      const entry = (this.state.openContestWorkspaces || []).find((item) => item.key === targetKey);
      if (!entry) {
        return [];
      }
      if (!(entry.problems || []).length) {
        return [new InfoTreeItem("暂无题目", "这场实验当前没有可见题目", "list-unordered")];
      }
      return (entry.problems || []).map((problem) => new ProblemTreeItem(
        problem,
        this.getProblemProgress(problem, entry.contest, entry.baseUrl),
        "xmuoj.openContestWorkspaceProblem",
        [{
          baseUrl: entry.baseUrl,
          contest: entry.contest,
          contestPassword: entry.contestPassword,
          problems: entry.problems,
          problem
        }],
        "problem",
        { baseUrl: entry.baseUrl, contest: entry.contest }
      ));
    }
    return [];
  }

  async getProblemWorkspaceChildren(item) {
    try {
      const workspace = await findExistingProblemWorkspace(item.problem, item.contest);
      if (!workspace) {
        return [new InfoTreeItem("暂无本地目录", "先点「题目」打开，再执行「打开代码」生成本地题目目录", "folder")];
      }
      return this.readWorkspaceEntries(workspace.problemDir, workspace.problemDir);
    } catch (error) {
      return [new InfoTreeItem("目录读取失败", error.message || String(error), "warning")];
    }
  }

  async getWorkspaceEntryChildren(item) {
    if (!item.entry.isDirectory) {
      return [];
    }
    try {
      return this.readWorkspaceEntries(item.entry.fullPath, item.rootDir);
    } catch (error) {
      return [new InfoTreeItem("目录读取失败", error.message || String(error), "warning")];
    }
  }

  async readWorkspaceEntries(targetDir, rootDir) {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const visibleEntries = entries
      .filter((entry) => entry.name !== ".DS_Store")
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        fullPath: path.join(targetDir, entry.name)
      }))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
      });
    if (!visibleEntries.length) {
      return [new InfoTreeItem("空文件夹", "这个目录里还没有文件", "folder-opened")];
    }
    return visibleEntries.map((entry) => new WorkspaceEntryTreeItem(entry, rootDir, this.state.currentTreeFilePath));
  }

  getProblemProgress(problem, contest = this.state.contestWorkspace ? this.state.contestWorkspace.contest : null, baseUrl = this.state.baseUrl || "") {
    const key = [baseUrl || "", contest ? contest.id : "problemset", problem.id].join("::");
    const progress = this.state.problemProgress ? this.state.problemProgress[key] : null;
    return progress || null;
  }
}

module.exports = {
  ProblemTreeDataProvider
};
