const fs = require("fs/promises");
const path = require("path");
const vscode = require("vscode");

const { findExistingProblemWorkspace } = require("./problemWorkspace");
const store = require("./workspaceStore");
const {
  buildProblemProgressKey,
  resolveProblemProgress,
  getProblemProgressSummary,
  normalizeContestStatus
} = require("./progress");

function isProblemColorizationEnabled() {
  return Boolean(vscode.workspace.getConfiguration("xmuoj").get("colorizeProblems", true));
}

function normalizeBaseUrlForKey(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function resolveProblemProgressScope() {
  const configuredRoot = String(vscode.workspace.getConfiguration("xmuoj").get("localWorkspaceRoot", "") || "").trim();
  if (configuredRoot) {
    try {
      return path.resolve(configuredRoot);
    } catch (_error) {
      return configuredRoot;
    }
  }
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length && folders[0] && folders[0].uri && folders[0].uri.fsPath) {
    try {
      return path.resolve(folders[0].uri.fsPath);
    } catch (_error) {
      return folders[0].uri.fsPath;
    }
  }
  return "global";
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
    "xmuoj.search": "search",
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
    "xmuoj.initContestWorkspace": "new-folder",
    "xmuoj.openRecentProblem": "history",
    "xmuoj.removeRecentProblem": "close"
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

function getContestStatusSummary(contest) {
  const status = normalizeContestStatus(contest ? contest.status : "");
  if (status.key === "ended") {
    return "已结束 · 仅本地测评";
  }
  if (status.key === "pending") {
    return "准备中";
  }
  if (status.key === "running") {
    return "进行中";
  }
  if (!contest || contest.status === undefined || contest.status === null) {
    return "本地目录";
  }
  return `状态未知（原始值：${status.label}）`;
}

function formatProgressDescription(progress, fallback = "未开始") {
  return getProblemProgressSummary(progress) || fallback;
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

class ActionTreeItem extends vscode.TreeItem {
  constructor(label, description, command, argumentsList = [], options = {}) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = options.id;
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
    this.id = options.id;
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

class RecentProblemTreeItem extends vscode.TreeItem {
  constructor(entry, progress) {
    super(`${entry.displayId || entry.display_id || entry.problemId} ${entry.title || ""}`.trim(), vscode.TreeItemCollapsibleState.None);
    this.id = `recent::${entry.identity}`;
    this.entry = entry;
    this.problem = entry.problem || {
      id: entry.problemId,
      display_id: entry.displayId || entry.display_id,
      title: entry.title
    };
    this.baseUrl = entry.baseUrl;
    this.contextValue = "recentProblem";
    const presentation = getProgressPresentation(progress);
    const source = entry.contestTitle || "公共题库";
    this.description = `${source} · ${formatProgressDescription(progress)}`;
    this.tooltip = `${this.label}\n${source}\n状态：${presentation.summary}`;
    this.iconPath = new vscode.ThemeIcon(
      presentation.iconId,
      isProblemColorizationEnabled() ? new vscode.ThemeColor(presentation.colorId) : undefined
    );
    this.command = {
      command: "xmuoj.openRecentProblem",
      title: "打开最近题目",
      arguments: [entry]
    };
  }
}

class ContestTreeItem extends vscode.TreeItem {
  constructor(entry, isActive) {
    super(entry.contest.title || `实验 ${entry.contest.id}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `contest::${entry.key}`;
    this.entry = entry;
    this.contest = entry.contest;
    this.baseUrl = entry.baseUrl;
    this.contextValue = "contestWorkspace";
    const statusSummary = getContestStatusSummary(entry.contest);
    const problemCount = (entry.problems || []).length;
    this.description = `${isActive ? "当前实验 · " : ""}${statusSummary} · ${problemCount} 题${entry.scanned ? " · 本地" : ""}`;
    this.tooltip = `${this.label}\n${statusSummary}\n${problemCount} 道题${entry.scanned ? "\n来自本地目录扫描" : ""}`;
    this.iconPath = makeThemeIcon(isActive ? "target" : "repo", isActive ? "charts.blue" : undefined);
  }
}

class WorkspaceEntryTreeItem extends vscode.TreeItem {
  constructor(entry, rootDir, activeFilePath) {
    super(entry.name, entry.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.id = `file::${entry.fullPath}`;
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
    if (element instanceof ContestTreeItem) {
      return this.getContestChildren(element.entry);
    }
    if (element instanceof ProblemTreeItem || element instanceof RecentProblemTreeItem) {
      return this.getProblemWorkspaceChildren(element);
    }
    if (element instanceof WorkspaceEntryTreeItem) {
      return this.getWorkspaceEntryChildren(element);
    }
    return [];
  }

  getRootSections() {
    const recentCount = (this.state.recentProblems || []).length;
    const contests = this.getContestEntries();
    const queueCount = (this.state.problemsetSelections || []).length;
    return [
      new SectionTreeItem("recent", "最近在做", recentCount ? `${recentCount} 道` : undefined, "history"),
      new SectionTreeItem("contests", "我的实验", contests.length ? `${contests.length} 场` : undefined, "repo"),
      new SectionTreeItem("problemset", "公共题库", queueCount ? `${queueCount} 道` : undefined, "book")
    ];
  }

  getSectionChildren(sectionId) {
    if (sectionId === "recent") {
      return this.getRecentSectionChildren();
    }
    if (sectionId === "contests") {
      return this.getContestsSectionChildren();
    }
    if (sectionId === "problemset") {
      return this.getProblemsetSectionChildren();
    }
    return [];
  }

  getRecentSectionChildren() {
    const entries = this.state.recentProblems || [];
    if (!entries.length) {
      return [
        new ActionTreeItem("搜索题目开始刷题", "按题号、标题或关键词搜索在线题目与本地目录", "xmuoj.search"),
        new InfoTreeItem("暂无最近题目", "打开任意题目后会出现在这里", "history")
      ];
    }
    return entries.map((entry) => new RecentProblemTreeItem(entry, this.getEntryProgress(entry)));
  }

  /**
   * 合并「已加载实验」（持久化）与「扫盘得到的实验」。
   * 扫盘条目只补题目，不覆盖服务端返回的实时题目列表。
   */
  getContestEntries() {
    const byKey = new Map();
    for (const entry of this.state.openContestWorkspaces || []) {
      if (!entry || !entry.contest) {
        continue;
      }
      const key = entry.key || `${normalizeBaseUrlForKey(entry.baseUrl)}::${entry.contest.id}`;
      byKey.set(key, Object.assign({}, entry, { key }));
    }
    const index = this.state.workspaceIndex;
    if (index && index.entries) {
      for (const group of store.groupIndexEntriesByContest(index)) {
        if (!group.contestId) {
          continue;
        }
        const baseUrl = normalizeBaseUrlForKey(group.entries[0] && group.entries[0].baseUrl) || normalizeBaseUrlForKey(this.state.baseUrl);
        const key = `${baseUrl}::${group.contestId}`;
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            key,
            baseUrl,
            contest: {
              id: group.contestId,
              title: group.contestTitle || `实验 ${group.contestId}`,
              status: null
            },
            problems: [],
            contestPassword: "",
            scanned: true
          };
          byKey.set(key, entry);
        }
        for (const item of group.entries) {
          if (!item || item.problemId === undefined || item.problemId === null) {
            continue;
          }
          if ((entry.problems || []).some((problem) => String(problem.id) === String(item.problemId))) {
            continue;
          }
          entry.problems = (entry.problems || []).concat([{
            id: item.problemId,
            display_id: item.displayId,
            title: item.title,
            difficulty: item.difficulty || "",
            languages: []
          }]);
        }
      }
    }
    return Array.from(byKey.values());
  }

  getContestsSectionChildren() {
    const entries = this.getContestEntries();
    const items = [new ActionTreeItem("搜索并加载实验", "按关键词搜索实验，加入下面的实验列表", "xmuoj.browseContests")];
    if (!entries.length) {
      items.push(new InfoTreeItem("暂无实验", "加载实验或打开题目后，磁盘上的实验会自动出现在这里", "repo"));
      return items;
    }
    const activeContestId = this.state.contestWorkspace && this.state.contestWorkspace.contest
      ? String(this.state.contestWorkspace.contest.id)
      : null;
    return items.concat(entries.map((entry) => new ContestTreeItem(
      entry,
      Boolean(activeContestId && String(entry.contest.id) === activeContestId)
    )));
  }

  getContestChildren(entry) {
    const problems = entry.problems || [];
    if (!problems.length) {
      return [new InfoTreeItem("暂无题目", "右键实验可刷新或批量创建题目目录", "list-unordered")];
    }
    const baseKey = `contest::${entry.key}::problem::`;
    return problems.map((problem) => new ProblemTreeItem(
      problem,
      this.getProblemProgress(problem, entry.contest, entry.baseUrl),
      "xmuoj.openContestWorkspaceProblem",
      [{
        baseUrl: entry.baseUrl,
        contest: entry.contest,
        contestPassword: entry.contestPassword,
        problems,
        problem
      }],
      "problem",
      { baseUrl: entry.baseUrl, contest: entry.contest, id: `${baseKey}${problem.id}` }
    ));
  }

  getProblemsetSectionChildren() {
    const items = [
      new ActionTreeItem("搜索题目", "在线搜索公共题库 + 本地工作区过滤", "xmuoj.search"),
      new ActionTreeItem("进入刷题台", "搜索公开题目、编排刷题队列并连续开刷", "xmuoj.browseProblemset"),
      new ActionTreeItem("打开题目目录", "在文件管理器中打开 root/problems", "xmuoj.revealProblemsetWorkspace")
    ];
    const selections = this.state.problemsetSelections || [];
    if (!selections.length) {
      items.push(new InfoTreeItem("暂无刷题队列", "在刷题台把题目加入队列，或直接搜索题目开始", "list-unordered"));
      return items;
    }
    items.push(new ActionTreeItem("管理队列", "从已添加题目中移除一题，或直接清空", "xmuoj.manageProblemsetSelections"));
    return items.concat(selections.map((item) => new ProblemTreeItem(
      item,
      this.getProblemProgress(item, null, item.baseUrl),
      "xmuoj.openProblemsetProblem",
      [item],
      "problemsetSelection",
      {
        baseUrl: item.baseUrl,
        id: `problemset::${normalizeBaseUrlForKey(item.baseUrl)}::${item.id}`
      }
    )));
  }

  async getProblemWorkspaceChildren(item) {
    try {
      // 树展开是只读操作：只查索引/旧路径，不触发目录迁移（迁移只发生在开题等显式动作）
      const workspace = await findExistingProblemWorkspace(item.problem, item.contest, {
        migrate: false,
        baseUrl: item.baseUrl
      });
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

  getEntryProgress(entry) {
    if (!entry) {
      return null;
    }
    return this.getProblemProgress(
      { id: entry.problemId, display_id: entry.displayId },
      entry.contestId ? { id: entry.contestId, title: entry.contestTitle } : null,
      entry.baseUrl
    );
  }

  getProblemProgress(problem, contest = this.state.contestWorkspace ? this.state.contestWorkspace.contest : null, baseUrl = this.state.baseUrl || "") {
    if (!problem || problem.id === undefined || problem.id === null) {
      return null;
    }
    return resolveProblemProgress(this.state.problemProgress, {
      key: buildProblemProgressKey(baseUrl, problem.id),
      baseUrl,
      problemId: problem.id,
      contestId: contest ? contest.id : null,
      progressScope: resolveProblemProgressScope()
    });
  }
}

module.exports = {
  ProblemTreeDataProvider
};
