const vscode = require("vscode");
const path = require("path");
const fs = require("fs/promises");

const { XmuojClient } = require("./client");
const { XmuojCodeLensProvider } = require("./codeLens");
const { ProblemTreeDataProvider } = require("./treeData");
const {
  METADATA_FILE_NAME,
  buildProblemDirectory,
  buildProblemMarkdown,
  chooseWorkspaceRoot,
  createWorkspaceTasks,
  ensureProblemWorkspace,
  findExistingProblemWorkspace,
  findProblemMetadata,
  getMetadataSourceFile,
  getSourceFileName,
  applyLanguageSwitch,
  saveTestCaseArchive,
  setMetadataSourceFile,
  slugifyTitle,
  getLocalWorkspaceFolderHandles,
  PROBLEMSET_DIR_NAME,
  writeProblemMetadata
} = require("./problemWorkspace");
const { runLocalCases } = require("./runner");

const RECENT_CONTESTS_KEY = "xmuoj.recentContests";
const RECENT_PROBLEMS_KEY = "xmuoj.recentProblems";
const LAST_SUBMISSION_RESULT_KEY = "xmuoj.lastSubmissionResult";
const LAST_LOCAL_REPORT_KEY = "xmuoj.lastLocalReport";
const PROBLEM_PROGRESS_KEY = "xmuoj.problemProgress";
const SUBMISSION_HISTORY_KEY = "xmuoj.submissionHistory";
const RECENT_SUBMISSION_SCOPE_KEY = "xmuoj.recentSubmissionScope";
const RECENT_SUBMISSION_DENSITY_KEY = "xmuoj.recentSubmissionDensity";
const RECENT_SUBMISSION_RESULT_FILTER_KEY = "xmuoj.recentSubmissionResultFilter";
const RECENT_SUBMISSION_LANGUAGE_FILTER_KEY = "xmuoj.recentSubmissionLanguageFilter";
const PROBLEMSET_SELECTIONS_KEY = "xmuoj.problemsetSelections";
const WORKBENCH_LAYOUT_KEY = "xmuoj.workbenchLayout";
const LANGUAGE_PRIORITY = ["C++", "Python3", "Java", "C"];
const ACCEPTED_RESULTS = new Set(["Accepted", "AC"]);
const LOCAL_LANGUAGE_FILE_CANDIDATES = {
  C: ["main.c"],
  "C++": ["main.cpp"],
  Java: ["Main.java"],
  Python3: ["main.py", "main.python"]
};
const LOCAL_LANGUAGE_TEMPLATES = {
  C: "#include <stdio.h>\n\nint main(void) {\n    return 0;\n}\n",
  "C++": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n",
  Java: "import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n    }\n}\n",
  Python3: "def main():\n    pass\n\n\nif __name__ == '__main__':\n    main()\n"
};

function isSideModeEnabled() {
  return Boolean(vscode.workspace.getConfiguration("xmuoj").get("enableSideMode", true));
}

function getProblemViewColumn() {
  return vscode.ViewColumn.One;
}

function getWorkspaceViewColumn() {
  return vscode.ViewColumn.Active;
}

function getResultViewColumn() {
  return vscode.ViewColumn.Active;
}

function inferLanguage(document) {
  const extension = document.fileName.split(".").pop().toLowerCase();
  const map = {
    c: "C",
    cc: "C++",
    cpp: "C++",
    cxx: "C++",
    java: "Java",
    py: "Python3"
  };
  return map[extension] || null;
}

function extractContestId(input) {
  const match = String(input).match(/contest\/(\d+)/);
  if (match) {
    return match[1];
  }
  return String(input).trim();
}

function normalizeContestStatus(status) {
  const raw = String(status || "").trim();
  const lower = raw.toLowerCase();
  if (raw === "-1") {
    return { key: "ended", label: "结束" };
  }
  if (raw === "0") {
    return { key: "running", label: "进行中" };
  }
  if (raw === "1") {
    return { key: "pending", label: "准备中" };
  }
  if (["ended", "end", "finished", "closed", "over"].includes(lower)) {
    return { key: "ended", label: "结束" };
  }
  if (["pending", "preparing", "scheduled", "not_started", "not-started"].includes(lower)) {
    return { key: "pending", label: "准备中" };
  }
  if (["running", "active", "started", "ongoing", "live"].includes(lower)) {
    return { key: "running", label: "进行中" };
  }
  if (["结束", "已结束"].includes(raw)) {
    return { key: "ended", label: "结束" };
  }
  if (["准备中", "未开始"].includes(raw)) {
    return { key: "pending", label: "准备中" };
  }
  if (["进行中", "已开始"].includes(raw)) {
    return { key: "running", label: "进行中" };
  }
  return { key: raw ? lower : "unknown", label: raw || "未知" };
}

function getContestStatusLabel(contest) {
  return normalizeContestStatus(contest && contest.status ? contest.status : "").label;
}

function canContestSubmitRemotely(contest) {
  return normalizeContestStatus(contest && contest.status ? contest.status : "").key === "running";
}

function buildContestSubmitBlockedMessage(contest) {
  const status = normalizeContestStatus(contest && contest.status ? contest.status : "");
  if (status.key === "ended") {
    return "该实验已结束，不能远程提交，只能本地测评。请使用“运行本地测试”。";
  }
  if (status.key === "pending") {
    return "该实验处于准备中，不能远程提交。请等待实验开始后再提交，或先使用“运行本地测试”。";
  }
  return `该实验当前状态为“${status.label}”，仅“进行中”的实验允许远程提交。请先使用“运行本地测试”。`;
}

function findContestEntryById(state, contestId) {
  if (!contestId) {
    return null;
  }
  return (state.openContestWorkspaces || []).find(
    (item) => item && item.contest && String(item.contest.id) === String(contestId)
  ) || null;
}

function getContestById(state, contestId) {
  if (!contestId) {
    return null;
  }
  if (
    state.contestWorkspace
    && state.contestWorkspace.contest
    && String(state.contestWorkspace.contest.id) === String(contestId)
  ) {
    return state.contestWorkspace.contest;
  }
  const entry = findContestEntryById(state, contestId);
  return entry && entry.contest ? entry.contest : null;
}

function resolveContestPassword(state, contestId) {
  if (!contestId) {
    return "";
  }
  if (
    state.contestWorkspace
    && state.contestWorkspace.contest
    && String(state.contestWorkspace.contest.id) === String(contestId)
    && state.contestPassword
  ) {
    return state.contestPassword;
  }
  const entry = findContestEntryById(state, contestId);
  if (entry && entry.contestPassword) {
    return entry.contestPassword;
  }
  return "";
}

function cacheContestPassword(state, contestId, contestPassword) {
  if (!contestId || !contestPassword) {
    return;
  }
  if (
    state.contestWorkspace
    && state.contestWorkspace.contest
    && String(state.contestWorkspace.contest.id) === String(contestId)
  ) {
    state.contestPassword = contestPassword;
  }
  state.openContestWorkspaces = (state.openContestWorkspaces || []).map((entry) => {
    if (entry && entry.contest && String(entry.contest.id) === String(contestId)) {
      return Object.assign({}, entry, { contestPassword });
    }
    return entry;
  });
}

function localizeServerErrorMessage(rawMessage) {
  const message = String(rawMessage || "");
  if (/contest.*(ended|over|closed|finished)|实验.*(结束|已结束)/i.test(message)) {
    return "该实验已结束，不能远程提交，只能本地测评。";
  }
  if (/contest.*(not started|has not started|preparing|pending)|实验.*(准备中|未开始)/i.test(message)) {
    return "该实验处于准备中，暂时不能远程提交。";
  }
  if (/contest[_\s-]*password.*(wrong|invalid|incorrect)|密码.*(错误|不正确)|wrong password/i.test(message)) {
    return "实验密码错误，请重新输入。";
  }
  if (/401|403|forbidden|permission denied|无权限/i.test(message)) {
    return "提交失败：没有权限访问该实验或实验密码不正确。";
  }
  if (/unauthorized|not logged in|authentication|please login|login first|login required|请先登录|登录/i.test(message)) {
    return "提交失败：请先登录 XMUOJ。";
  }
  return message;
}

function isAuthErrorMessage(message) {
  return /please login|login first|login required|unauthorized|not logged in|authentication|请先登录|登录|401|403/i.test(
    String(message || "")
  );
}

/**
 * 统一处理 XmuojClient 抛出的错误。
 * 鉴权类错误（未登录 / token 失效；服务端以 HTTP 200 + {"error":...,"data":"Please login first."} 返回）
 * 会清掉本地失效登录态、刷新状态栏与题目树，并弹出带「登录」按钮的中文提示。
 * 其它错误走 localizeServerErrorMessage 本地化后展示。
 */
async function handleXmuojError(error, state, client, treeProvider, { offerLogin = true } = {}) {
  const raw = String(error && error.message ? error.message : error);
  if (isAuthErrorMessage(raw)) {
    state.user = null;
    try {
      await client.setToken("");
    } catch (_error) {
      /* ignore token-clear failure */
    }
    try {
      await client.setSessionCookies("");
    } catch (_error) {
      /* ignore cookie-clear failure */
    }
    if (state.userStatusBar && state.contestStatusBar) {
      updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
    }
    const refreshTarget = treeProvider || state.treeDataProvider;
    if (refreshTarget && typeof refreshTarget.refresh === "function") {
      refreshTarget.refresh();
    }
    const action = offerLogin
      ? await vscode.window.showErrorMessage("请先登录 XMUOJ 再执行此操作。", "登录")
      : undefined;
    if (action === "登录") {
      await vscode.commands.executeCommand("xmuoj.login");
    }
    return;
  }
  vscode.window.showErrorMessage(localizeServerErrorMessage(raw));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 把 HTML 片段里 <img>/<source> 的相对 src 转成绝对 URL。
 * webview 的 base 是 vscode-webview://，相对路径（/public/xxx 或 public/xxx）
 * 无法解析到 xmuoj.com，必须显式拼上 baseUrl。
 * 已是 http(s):/data:/blob:/vscode-: 协议的保持不变。
 */
function resolveRelativeUrls(html, baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!html || !base) {
    return html || "";
  }
  const resolveSrc = (rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url) {
      return url;
    }
    if (/^(https?:|data:|blob:|vscode-|file:)/i.test(url)) {
      return url;
    }
    // 协议相对 //host/... → 用 base 的协议补成 http(s)://host/...
    if (url.startsWith("//")) {
      const proto = /^(https?:)/i.exec(base);
      return (proto ? proto[1] : "http:") + url;
    }
    if (url.startsWith("/")) {
      return base + url;
    }
    return base + "/" + url;
  };
  // 匹配 <img ... src="..." ...> 和 <img ... src='...' ...>
  return String(html)
    .replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi, (match, prefix, quote, url) => prefix + quote + resolveSrc(url) + quote)
    .replace(/(<source\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi, (match, prefix, quote, url) => prefix + quote + resolveSrc(url) + quote)
    // srcset="url1 1x, url2 2x"
    .replace(/(<img\b[^>]*?\bsrcset=)(["'])([^"']*)\2/gi, (match, prefix, quote, candidates) => {
      const resolved = candidates.split(",").map((entry) => {
        const parts = entry.trim().split(/\s+/);
        if (parts[0]) {
          parts[0] = resolveSrc(parts[0]);
        }
        return parts.join(" ");
      }).join(", ");
      return prefix + quote + resolved + quote;
    });
}

const ACTION_ICONS = {
  startWork: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>',
  continueWork: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-1.5-1.5a1.003 1.003 0 0 0-1.42 0l-1.17 1.17 2.75 2.75 1.34-1Z" fill="currentColor"/></svg>',
  runTests: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v2l2 3v7.5A4.5 4.5 0 0 0 15.5 20h1A4.5 4.5 0 0 0 21 15.5V8l2-3V3H9Zm4 5h6v7.5a2.5 2.5 0 0 1-2.5 2.5h-1A2.5 2.5 0 0 1 13 15.5V8Z" fill="currentColor"/></svg>',
  downloadTests: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v8.17l2.59-2.58L17 11l-5 5-5-5 1.41-1.41L11 12.17V4Zm-5 14h12v2H6v-2Z" fill="currentColor"/></svg>',
  submit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20v-6l13-2-13-2V4l18 8-18 8Z" fill="currentColor"/></svg>',
  showResults: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h3v10H5V9Zm5-4h3v14h-3V5Zm5 7h3v7h-3v-7Z" fill="currentColor"/></svg>',
  switchLanguage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Zm6.93 9h-3.09a15.65 15.65 0 0 0-1.38-5.03A8.03 8.03 0 0 1 18.93 11ZM12 4.07A13.74 13.74 0 0 1 13.82 11h-3.64A13.74 13.74 0 0 1 12 4.07ZM4.06 13h3.09a15.65 15.65 0 0 0 1.38 5.03A8.03 8.03 0 0 1 4.06 13Zm3.09-2H4.06a8.03 8.03 0 0 1 4.47-5.03A15.65 15.65 0 0 0 7.15 11ZM12 19.93A13.74 13.74 0 0 1 10.18 13h3.64A13.74 13.74 0 0 1 12 19.93ZM10.18 11a13.74 13.74 0 0 1 1.82-6.93A13.74 13.74 0 0 1 13.82 11Zm4.64 2a15.65 15.65 0 0 1-1.38 5.03A15.65 15.65 0 0 1 12.06 13h2.76Zm-.88 5.03A8.03 8.03 0 0 0 18.93 13h-3.09a15.65 15.65 0 0 1-1.38 5.03Z" fill="currentColor"/></svg>',
  language: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Zm6.93 9h-3.09a15.65 15.65 0 0 0-1.38-5.03A8.03 8.03 0 0 1 18.93 11ZM12 4.07A13.74 13.74 0 0 1 13.82 11h-3.64A13.74 13.74 0 0 1 12 4.07ZM4.06 13h3.09a15.65 15.65 0 0 0 1.38 5.03A8.03 8.03 0 0 1 4.06 13Zm3.09-2H4.06a8.03 8.03 0 0 1 4.47-5.03A15.65 15.65 0 0 0 7.15 11ZM12 19.93A13.74 13.74 0 0 1 10.18 13h3.64A13.74 13.74 0 0 1 12 19.93ZM10.18 11a13.74 13.74 0 0 1 1.82-6.93A13.74 13.74 0 0 1 13.82 11Zm4.64 2a15.65 15.65 0 0 1-1.38 5.03A15.65 15.65 0 0 1 12.06 13h2.76Zm-.88 5.03A8.03 8.03 0 0 0 18.93 13h-3.09a15.65 15.65 0 0 1-1.38 5.03Z" fill="currentColor"/></svg>'
};

function normalizeProgressScope(scope) {
  if (!scope) {
    return "global";
  }
  const value = String(scope).trim();
  if (!value) {
    return "global";
  }
  try {
    return path.resolve(value);
  } catch (_error) {
    return value;
  }
}

function resolveProblemProgressScope() {
  const configuredRoot = String(vscode.workspace.getConfiguration("xmuoj").get("localWorkspaceRoot", "") || "").trim();
  if (configuredRoot) {
    return normalizeProgressScope(configuredRoot);
  }
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length && folders[0] && folders[0].uri && folders[0].uri.fsPath) {
    return normalizeProgressScope(folders[0].uri.fsPath);
  }
  return "global";
}

function buildProblemProgressKey(baseUrl, contestId, problemId, progressScope) {
  return [
    normalizeBaseUrlForKey(baseUrl),
    contestId || "problemset",
    problemId || "unknown",
    normalizeProgressScope(progressScope || resolveProblemProgressScope())
  ].join("::");
}

function normalizeBaseUrlForKey(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function buildContestWorkspaceKey(baseUrl, contestId) {
  return [normalizeBaseUrlForKey(baseUrl), String(contestId || "")].join("::");
}

function upsertProblemsetSelection(state, problem, baseUrl) {
  const nextItem = {
    id: problem.id,
    display_id: problem.display_id,
    title: problem.title,
    difficulty: problem.difficulty || "",
    languages: problem.languages || [],
    baseUrl
  };
  const next = (state.problemsetSelections || [])
    .filter((item) => !(String(item.id) === String(nextItem.id) && normalizeBaseUrlForKey(item.baseUrl) === normalizeBaseUrlForKey(baseUrl)))
    .concat(nextItem)
    .slice(-100);
  state.problemsetSelections = next;
  return next;
}

async function persistProblemsetSelections(context, state) {
  await context.globalState.update(PROBLEMSET_SELECTIONS_KEY, state.problemsetSelections || []);
}

function upsertContestWorkspaceSelection(state, workspace, baseUrl) {
  const key = buildContestWorkspaceKey(baseUrl, workspace && workspace.contest ? workspace.contest.id : null);
  const nextItem = {
    key,
    baseUrl,
    contest: workspace.contest,
    problems: workspace.problems || [],
    contestPassword: state.contestPassword || ""
  };
  const next = [
    nextItem,
    ...(state.openContestWorkspaces || []).filter((item) => item.key !== key)
  ].slice(0, 12);
  state.openContestWorkspaces = next;
  return next;
}

function removeProblemsetSelection(state, item) {
  state.problemsetSelections = (state.problemsetSelections || []).filter((entry) => !(String(entry.id) === String(item.id) && normalizeBaseUrlForKey(entry.baseUrl) === normalizeBaseUrlForKey(item.baseUrl)));
  return state.problemsetSelections;
}

function clearProblemsetSelections(state) {
  state.problemsetSelections = [];
  return state.problemsetSelections;
}

function buildProblemsetSelectionKey(problem, baseUrl) {
  return [normalizeBaseUrlForKey(baseUrl), String(problem && problem.id ? problem.id : "")].join("::");
}

function getProblemsetSelectionIndex(state, problem, baseUrl) {
  const key = buildProblemsetSelectionKey(problem, baseUrl);
  return (state.problemsetSelections || []).findIndex((item) => buildProblemsetSelectionKey(item, item.baseUrl) === key);
}

function getNextProblemsetSelection(state, baseUrl) {
  const selections = (state.problemsetSelections || []).filter((item) => normalizeBaseUrlForKey(item.baseUrl) === normalizeBaseUrlForKey(baseUrl));
  if (!selections.length) {
    return null;
  }
  if (!state.activeProblem) {
    return selections[0];
  }
  const currentIndex = getProblemsetSelectionIndex(state, state.activeProblem, baseUrl);
  if (currentIndex < 0) {
    return selections[0];
  }
  return selections[currentIndex + 1] || null;
}

function getRandomProblemsetSelection(state, baseUrl) {
  const selections = (state.problemsetSelections || []).filter((item) => normalizeBaseUrlForKey(item.baseUrl) === normalizeBaseUrlForKey(baseUrl));
  if (!selections.length) {
    return null;
  }
  return selections[Math.floor(Math.random() * selections.length)] || null;
}

function removeContestWorkspaceSelection(state, item) {
  state.openContestWorkspaces = (state.openContestWorkspaces || []).filter((entry) => entry.key !== item.key);
  if (state.contestWorkspace && item.contest && state.contestWorkspace.contest && String(state.contestWorkspace.contest.id) === String(item.contest.id)) {
    state.contestWorkspace = null;
    state.activeContest = null;
    state.contestPassword = "";
  }
  return state.openContestWorkspaces;
}

function clearContestContext(state) {
  state.contestWorkspace = null;
  state.activeContest = null;
  state.contestPassword = "";
}

function syncActiveContestByEntry(state, workspaceEntry) {
  if (!workspaceEntry || !workspaceEntry.contest) {
    return;
  }
  state.contestWorkspace = {
    contest: workspaceEntry.contest,
    problems: workspaceEntry.problems || []
  };
  state.contestPassword = workspaceEntry.contestPassword || "";
  state.activeContest = workspaceEntry.contest;
}

function buildProblemProgressRef(baseUrl, problem, contest, options = {}) {
  if (!problem || !problem.id) {
    return null;
  }
  const progressScope = normalizeProgressScope(options.progressScope || resolveProblemProgressScope());
  return {
    key: buildProblemProgressKey(baseUrl, contest ? contest.id : null, problem.id, progressScope),
    baseUrl,
    problemId: problem.id,
    displayId: problem.display_id,
    title: problem.title,
    contestId: contest ? contest.id : null,
    contestTitle: contest ? contest.title : null,
    progressScope
  };
}

function getProblemProgress(state, baseUrl, problem, contest, options = {}) {
  if (!state.problemProgress || !problem || !problem.id) {
    return null;
  }
  const progressScope = normalizeProgressScope(options.progressScope || resolveProblemProgressScope());
  return state.problemProgress[buildProblemProgressKey(baseUrl, contest ? contest.id : null, problem.id, progressScope)] || null;
}

function getProblemProgressSummary(progress) {
  if (!progress) {
    return "未开始";
  }
  if (progress.accepted) {
    return "已 AC";
  }
  if (progress.lastSubmissionLabel) {
    return `已提交 · ${progress.lastSubmissionLabel}`;
  }
  if (progress.localPassed) {
    return "本地通过";
  }
  if (progress.workspaceCreated) {
    return "已开题";
  }
  return "未开始";
}

async function updateXmuojConfiguration(relativeKey, value) {
  const fullKey = `xmuoj.${relativeKey}`;
  try {
    await vscode.workspace.getConfiguration("xmuoj").update(relativeKey, value, vscode.ConfigurationTarget.Global);
    return;
  } catch (error) {
    try {
      await vscode.workspace.getConfiguration().update(fullKey, value, vscode.ConfigurationTarget.Global);
      return;
    } catch (fallbackError) {
      const message = String((fallbackError && fallbackError.message) || (error && error.message) || fallbackError || error);
      if (/没有注册配置|not a registered configuration/i.test(message)) {
        throw new Error(`当前 VS Code 还没识别到配置项 ${fullKey}。这通常是因为安装了新 VSIX 后还没重载窗口，或者当前运行的不是最新版本插件。请先执行“开发人员: 重新加载窗口”，再重试；如果仍失败，请重新安装最新的 XMUOJ VSIX。`);
      }
      throw fallbackError;
    }
  }
}

function buildProblemLookupKeywords(metadata) {
  const keywords = [];
  if (metadata && metadata.title) {
    keywords.push(String(metadata.title).trim());
  }
  if (metadata && metadata.displayId) {
    keywords.push(String(metadata.displayId).trim());
  }
  return keywords.filter(Boolean);
}

function findMatchingProblemCandidate(results, metadata) {
  const title = metadata && metadata.title ? String(metadata.title).trim() : "";
  const displayId = metadata && metadata.displayId ? String(metadata.displayId).trim() : "";
  if (!Array.isArray(results) || !results.length) {
    return null;
  }
  return results.find((item) => title && item.title === title && (!displayId || item.display_id === displayId))
    || results.find((item) => title && item.title === title)
    || results.find((item) => displayId && item.display_id === displayId)
    || null;
}

async function tryResolveProblemBinding(client, metadata) {
  const keywords = buildProblemLookupKeywords(metadata);
  for (const keyword of keywords) {
    const response = await client.getProblemset({ keyword, limit: 20, offset: 0 });
    const candidate = findMatchingProblemCandidate(response.results || [], metadata);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

async function validateProblemBinding(client, metadata, contestPassword) {
  try {
    const detail = await client.getProblemWorkspace(
      metadata.problemId,
      metadata.contestId || undefined,
      contestPassword || undefined
    );
    return { ok: true, detail };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/Problem does not exist/i.test(message)) {
      return { ok: false, reason: "missing_problem", error: message };
    }
    return { ok: false, reason: "other", error: message };
  }
}

async function ensureValidProblemBinding(client, state, metadataContext) {
  if (!metadataContext || !metadataContext.metadata) {
    return { ok: false, detail: null };
  }
  const contestPassword = resolveContestPassword(state, metadataContext.metadata.contestId);
  const validation = await validateProblemBinding(client, metadataContext.metadata, contestPassword || undefined);
  if (validation.ok) {
    return validation;
  }
  if (validation.reason !== "missing_problem") {
    throw new Error(validation.error);
  }
  const candidate = await tryResolveProblemBinding(client, metadataContext.metadata);
  const prompt = candidate
    ? "当前题目元数据里的题号已失效，但我找到了一个可能匹配的题目。是否重新绑定后继续？"
    : "当前题目元数据里的题号已失效。是否重新搜索并重新绑定当前题目？";
  const choice = await vscode.window.showWarningMessage(prompt, "重新绑定", "取消");
  if (choice !== "重新绑定") {
    return { ok: false, cancelled: true, detail: null };
  }
  const rebound = candidate || await tryResolveProblemBinding(client, metadataContext.metadata);
  if (!rebound) {
    throw new Error("没有找到可重新绑定的同名题目。请从题库或比赛列表重新打开这道题后再提交。");
  }
  const reboundDetail = await client.getProblemWorkspace(
    rebound.id,
    metadataContext.metadata.contestId || undefined,
    contestPassword || undefined
  );
  metadataContext.metadata = Object.assign({}, metadataContext.metadata, {
    problemId: reboundDetail.id,
    displayId: reboundDetail.display_id,
    title: reboundDetail.title,
    sourceFile: getMetadataSourceFile(metadataContext.metadata, metadataContext.metadata.language) || getSourceFileName(metadataContext.metadata.language)
  });
  await writeProblemMetadata(metadataContext.problemDir, metadataContext.metadata);
  return { ok: true, detail: reboundDetail, rebound: true };
}

async function rebindProblemFromMetadata(client, state, metadataContext) {
  if (!metadataContext || !metadataContext.metadata || !metadataContext.problemDir) {
    throw new Error("当前文件不在 XMUOJ 题目工作区内，无法重新绑定题目。");
  }
  const candidate = await tryResolveProblemBinding(client, metadataContext.metadata);
  if (!candidate) {
    throw new Error("没有找到可重新绑定的同名题目。请从题库或比赛列表重新打开这道题。");
  }
  const detail = await client.getProblemWorkspace(
    candidate.id,
    metadataContext.metadata.contestId || undefined,
    state.contestPassword || undefined
  );
  metadataContext.metadata = Object.assign({}, metadataContext.metadata, {
    problemId: detail.id,
    displayId: detail.display_id,
    title: detail.title,
    sourceFile: getMetadataSourceFile(metadataContext.metadata, metadataContext.metadata.language) || getSourceFileName(metadataContext.metadata.language)
  });
  await writeProblemMetadata(metadataContext.problemDir, metadataContext.metadata);
  return detail;
}

function renderActionButton(command, iconKey, label, variant = "secondary") {
  const icon = ACTION_ICONS[iconKey] || ACTION_ICONS.startWork;
  return `<button class="action-button ${variant} icon-button" data-command="${command}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><span class="action-button-icon">${icon}</span><span class="action-button-label">${escapeHtml(label)}</span></button>`;
}

async function updateProblemProgress(context, state, progressRef, patch) {
  if (!progressRef || !progressRef.key) {
    return null;
  }
  const current = state.problemProgress[progressRef.key] || {};
  const next = Object.assign({}, current, {
    baseUrl: progressRef.baseUrl,
    problemId: progressRef.problemId,
    displayId: progressRef.displayId,
    title: progressRef.title,
    contestId: progressRef.contestId,
    contestTitle: progressRef.contestTitle,
    progressScope: progressRef.progressScope,
    updatedAt: new Date().toISOString()
  }, patch);
  state.problemProgress = Object.assign({}, state.problemProgress, {
    [progressRef.key]: next
  });
  await context.globalState.update(PROBLEM_PROGRESS_KEY, state.problemProgress);
  return next;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function scanProblemDirLanguages(problemDir) {
  const result = {};
  for (const language of LANGUAGE_PRIORITY) {
    const candidates = LOCAL_LANGUAGE_FILE_CANDIDATES[language] || [getSourceFileName(language)];
    let foundFile = null;
    for (const candidate of candidates) {
      if (await fileExists(path.join(problemDir, candidate))) {
        foundFile = candidate;
        break;
      }
    }
    result[language] = {
      exists: Boolean(foundFile),
      fileName: foundFile || getSourceFileName(language)
    };
  }
  return result;
}

function buildLanguageSwitchPickItems(languageState, currentLanguage) {
  return LANGUAGE_PRIORITY.map((language) => {
    const item = languageState[language] || { exists: false, fileName: getSourceFileName(language) };
    const current = currentLanguage === language;
    return {
      label: current
        ? `${language}（当前）`
        : item.exists
          ? `切换到 ${language}`
          : `创建 ${language} 模板`,
      description: item.fileName,
      detail: item.exists ? "已存在本地代码文件" : "将创建新的本地模板文件",
      language,
      exists: item.exists,
      fileName: item.fileName
    };
  });
}

async function switchProblemLanguageLocally(context, state, client, treeProvider, menuItem) {
  const request = await resolveLanguageSwitchRequest(client, state, menuItem);
  if (!request.sourceContext || !request.sourceContext.metadataContext || !request.sourceContext.metadataContext.problemDir) {
    return;
  }
  const { metadataContext } = request.sourceContext;
  const problemDir = metadataContext.problemDir;
  const currentLanguage = metadataContext.metadata.language || inferLanguage(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) || "";
  const languageState = await scanProblemDirLanguages(problemDir);
  const picks = buildLanguageSwitchPickItems(languageState, currentLanguage);
  const picked = await vscode.window.showQuickPick(picks, {
    title: "选择要打开或创建的代码语言",
    ignoreFocusOut: true,
    placeHolder: "已有代码将直接切换；不存在的语言将创建模板文件"
  });
  if (!picked) {
    return;
  }
  const targetLanguage = picked.language;
  const targetFile = picked.fileName || getSourceFileName(targetLanguage);
  const targetPath = path.join(problemDir, targetFile);
  let created = false;
  if (!picked.exists) {
    await fs.writeFile(targetPath, LOCAL_LANGUAGE_TEMPLATES[targetLanguage] || "", "utf8");
    created = true;
  }
  metadataContext.metadata = setMetadataSourceFile(metadataContext.metadata, targetLanguage, targetFile);
  await writeProblemMetadata(problemDir, metadataContext.metadata);
  const document = await vscode.workspace.openTextDocument(targetPath);
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active });
  await rememberSourceFile(context, state, targetPath);
  state.currentTreeFilePath = targetPath;
  if (metadataContext.metadata && metadataContext.metadata.problemId) {
    await updateProblemProgress(
      context,
      state,
      buildProblemProgressRef(
        metadataContext.metadata.baseUrl || client.baseUrl,
        {
          id: metadataContext.metadata.problemId,
          display_id: metadataContext.metadata.displayId,
          title: metadataContext.metadata.title
        },
        metadataContext.metadata.contestId ? { id: metadataContext.metadata.contestId, title: metadataContext.metadata.contestTitle } : null
      ),
      {
        workspaceCreated: true,
        language: targetLanguage,
        sourceFile: targetFile
      }
    );
  }
  if (treeProvider) {
    treeProvider.refresh();
  }
  await refreshProblemPanel(state, client, request.problem || state.activeProblem, request.contest || state.activeContest);
  vscode.window.showInformationMessage(created ? `已创建并切换到 ${targetLanguage} 模板` : `已切换到 ${targetLanguage}`);
}

function renderProblemHtml(problem, baseUrl, workspaceState = {}, _user = null) {
  const actionLabel = workspaceState.hasWorkspace ? "打开代码" : "创建代码";
  const progressBadge = workspaceState.progressSummary ? `<span class="pill">${escapeHtml(workspaceState.progressSummary)}</span>` : "";
  const samples = (problem.samples || []).map((sample, index) => `
    <section class="sample-block">
      <h3>样例 ${index + 1}</h3>
      <div class="grid">
        <div>
          <h4>输入</h4>
          <pre>${escapeHtml(sample.input || "")}</pre>
        </div>
        <div>
          <h4>输出</h4>
          <pre>${escapeHtml(sample.output || "")}</pre>
        </div>
      </div>
    </section>
  `).join("");
  const testCases = problem.test_case_manifest
    ? problem.test_case_manifest.test_cases.map((item, index) => `<li>测试点 ${index + 1}：${escapeHtml(item.input_name || "")}${item.output_name ? ` / ${escapeHtml(item.output_name)}` : ""}</li>`).join("")
    : "";

  const downloadLink = problem.test_case_manifest
    ? `${baseUrl}${problem.test_case_manifest.download_url}`
    : "";
  // 题面 HTML 里的 <img src="/public/..."> 是相对路径，webview 解析不到；
  // 统一转成绝对 URL（已是 http(s):/data: 等协议的保持不变）。
  const description = resolveRelativeUrls(problem.description || "", baseUrl);
  const inputDescription = resolveRelativeUrls(problem.input_description || "", baseUrl);
  const outputDescription = resolveRelativeUrls(problem.output_description || "", baseUrl);
  const hint = resolveRelativeUrls(problem.hint || "", baseUrl);
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data: blob:; media-src http: https: data: blob:; style-src 'unsafe-inline' http: https:; script-src 'unsafe-inline' https://cdn.jsdelivr.net; font-src https: data:; connect-src http: https:;" />
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 24px; background: linear-gradient(180deg, #f3efe3 0%, #f7f7f2 100%); color: #17312f; }
        h1, h2, h3, h4 { color: #0b5d5b; }
        .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
        .pill { background: #d7ebe5; border-radius: 999px; padding: 6px 12px; font-size: 12px; }
        .panel { background: rgba(255,255,255,0.72); border: 1px solid #d5ddd4; border-radius: 16px; padding: 18px; margin-bottom: 18px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
        .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 8px; margin-bottom: 18px; align-items: stretch; }
        .action-button { border: 0; border-radius: 16px; padding: 8px 8px; background: #0b5d5b; color: #f7f7f2; cursor: pointer; font-size: 12px; }
        .action-button.secondary { background: #d7ebe5; color: #17312f; }
        .icon-button { min-height: 60px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; line-height: 1; box-shadow: 0 2px 8px rgba(11, 93, 91, 0.08); border: 1px solid rgba(11, 93, 91, 0.08); }
        .icon-button.primary { background: #0b5d5b; color: #f7f7f2; }
        .icon-button:hover { transform: translateY(-1px); }
        .action-button-icon { display: inline-flex; width: 16px; height: 16px; }
        .action-button-icon svg { width: 16px; height: 16px; display: block; }
        .action-button-label { font-size: 10px; line-height: 1.2; font-weight: 600; text-align: center; }
        pre { white-space: pre-wrap; background: #132322; color: #f6f3ea; padding: 12px; border-radius: 12px; overflow: auto; }
        a { color: #9a3b2f; }
        img { max-width: 100%; height: auto; }
      </style>
      <script>
        window.MathJax = {
          tex: {
            inlineMath: [['$', '$'], ['\\\\(', '\\\\)']],
            displayMath: [['$$', '$$'], ['\\\\[', '\\\\]']],
            processEscapes: true
          },
          options: {
            skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
          },
          svg: { fontCache: 'global' }
        };
      </script>
      <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    </head>
    <body>
      <h1>${escapeHtml(problem.display_id)} ${escapeHtml(problem.title)}</h1>
      <div class="actions">
        ${renderActionButton("startWork", workspaceState.hasWorkspace ? "continueWork" : "startWork", actionLabel, "primary")}
        ${workspaceState.hasWorkspace ? renderActionButton("switchLanguage", "language", "切换代码语言") : ""}
        ${renderActionButton("downloadTests", "downloadTests", "下载数据")}
      </div>
      <div class="meta">
        ${progressBadge}
        <span class="pill">${escapeHtml(problem.rule_type)}</span>
        <span class="pill">${escapeHtml(problem.difficulty || "未知")}</span>
      </div>
      <section class="panel">${description}</section>
      <section class="panel">
        <h2>输入描述</h2>
        ${inputDescription}
        <h2>输出描述</h2>
        ${outputDescription}
      </section>
      ${samples ? `<section class="panel"><h2>样例</h2>${samples}</section>` : ""}
      ${hint ? `<section class="panel"><h2>提示</h2>${hint}</section>` : ""}
      ${problem.test_case_manifest ? `<section class="panel"><h2>公开测试数据</h2><ul>${testCases}</ul><p><a href="${downloadLink}">下载测试数据压缩包</a></p></section>` : ""}
      <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('[data-command]').forEach((button) => {
          button.addEventListener('click', () => {
            vscode.postMessage({ command: button.getAttribute('data-command') });
          });
        });
      </script>
    </body>
  </html>`;
}

function renderProblemsetWorkbenchRow(problem, state, baseUrl) {
  const progress = getProblemProgress(state, baseUrl, problem, null);
  const progressSummary = getProblemProgressSummary(progress);
  const tags = Array.isArray(problem.tags) && problem.tags.length
    ? problem.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")
    : '<span class="tag muted">暂无标签</span>';
  const languages = Array.isArray(problem.languages) && problem.languages.length ? problem.languages.join(" · ") : "未知语言";
  const payload = escapeHtml(JSON.stringify(problem));
  return `
    <tr>
      <td class="problem-cell-actions">
        <button class="primary icon-only" data-command="addQueue" data-problem="${payload}" title="加入队列" aria-label="加入队列">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10v2H4V7Zm0 4h10v2H4v-2Zm0 4h8v2H4v-2Zm11-5V7h2v3h3v2h-3v3h-2v-3h-3v-2h3Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-only" data-command="startProblem" data-problem="${payload}" title="开刷" aria-label="开刷">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13L18 12 8 5.5Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-only" data-command="openProblem" data-problem="${payload}" title="查看题面" aria-label="查看题面">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c5.2 0 8.7 5 9 5.5.1.2.1.4 0 .6-.3.5-3.8 5.5-9 5.5s-8.7-5-9-5.5a.7.7 0 0 1 0-.6C3.3 11 6.8 6 12 6Zm0 2c-3.6 0-6.3 3.1-7 4 1 1.3 3.6 4 7 4 3.6 0 6.3-3.1 7-4-1-1.3-3.6-4-7-4Zm0 1.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" fill="currentColor"/></svg>
        </button>
      </td>
      <td class="problem-cell-code">${escapeHtml(problem.display_id)}</td>
      <td class="problem-cell-title">
        <div class="problem-title-wrap">
          <strong>${escapeHtml(problem.title)}</strong>
          <div class="problem-subtitle">
            <span class="status-pill">${escapeHtml(progressSummary)}</span>
            ${problem.can_download_test_case ? '<span class="meta-pill accent">可下载数据</span>' : ""}
          </div>
        </div>
      </td>
      <td class="problem-cell-meta">${escapeHtml(problem.difficulty || "未知难度")}</td>
      <td class="problem-cell-meta">${escapeHtml(languages)}</td>
      <td class="problem-cell-tags">${tags}</td>
    </tr>
  `;
}

function renderProblemsetQueueRow(problem, state, baseUrl) {
  const progress = getProblemProgress(state, baseUrl, problem, null);
  const progressSummary = getProblemProgressSummary(progress);
  const payload = escapeHtml(JSON.stringify(problem));
  return `
    <tr>
      <td class="problem-cell-actions">
        <button class="primary icon-only" data-command="startQueueItem" data-problem="${payload}" title="开始刷题" aria-label="开始刷题">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13L18 12 8 5.5Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-only" data-command="openQueueItem" data-problem="${payload}" title="查看题面" aria-label="查看题面">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c5.2 0 8.7 5 9 5.5.1.2.1.4 0 .6-.3.5-3.8 5.5-9 5.5s-8.7-5-9-5.5a.7.7 0 0 1 0-.6C3.3 11 6.8 6 12 6Zm0 2c-3.6 0-6.3 3.1-7 4 1 1.3 3.6 4 7 4 3.6 0 6.3-3.1 7-4-1-1.3-3.6-4-7-4Zm0 1.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4Z" fill="currentColor"/></svg>
        </button>
        <button class="icon-only" data-command="removeQueueItem" data-problem="${payload}" title="移除" aria-label="移除">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l1 1h4v2H4V5h4l1-1Zm1 6h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Z" fill="currentColor"/></svg>
        </button>
      </td>
      <td class="problem-cell-code">${escapeHtml(problem.display_id)}</td>
      <td class="problem-cell-title">
        <div class="problem-title-wrap">
          <strong>${escapeHtml(problem.title)}</strong>
          <div class="problem-subtitle"><span class="status-pill">${escapeHtml(progressSummary)}</span></div>
        </div>
      </td>
      <td class="problem-cell-meta">${escapeHtml(problem.difficulty || "未知难度")}</td>
    </tr>
  `;
}

function renderProblemsetWorkbenchSkeleton(message = "正在加载公共题库刷题台…") {
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17312f; background: radial-gradient(circle at top left, #f7ead2 0%, #f8f7f2 35%, #eef5f0 100%); }
        .shell { max-width: 1280px; margin: 0 auto; padding: 24px; }
        .panel { background: rgba(255,255,255,0.78); border: 1px solid rgba(23,49,47,0.08); border-radius: 22px; padding: 18px; box-shadow: 0 12px 36px rgba(23,49,47,0.06); backdrop-filter: blur(16px); }
        .loading-card { min-height: 240px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #526b66; }
      </style>
    </head>
    <body>
      <div class="shell">
        <div class="panel loading-card">${escapeHtml(message)}</div>
      </div>
    </body>
  </html>`;
}

function renderProblemsetTable(results, state, baseUrl) {
  if (!results.length) {
    return '<div class="empty">先搜索一道题，再把它加入队列。你也可以直接点“直接开刷”。</div>';
  }
  return `
    <div class="table-shell">
      <table class="problem-table">
        <thead>
          <tr>
            <th>操作</th>
            <th>题号</th>
            <th>题目</th>
            <th>难度</th>
            <th>语言</th>
            <th>标签</th>
          </tr>
        </thead>
        <tbody>
          ${results.map((problem) => renderProblemsetWorkbenchRow(problem, state, baseUrl)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderProblemsetQueueTable(queue, state, baseUrl) {
  if (!queue.length) {
    return '<div class="empty">当前队列为空。先在搜索结果里加入几道题，再开始连续刷题。</div>';
  }
  return `
    <div class="table-shell queue-shell">
      <table class="problem-table queue-table">
        <thead>
          <tr>
            <th>操作</th>
            <th>题号</th>
            <th>题目</th>
            <th>难度</th>
          </tr>
        </thead>
        <tbody>
          ${queue.map((problem) => renderProblemsetQueueRow(problem, state, baseUrl)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderProblemsetWorkbenchHtml(viewModel) {
  const total = Number(viewModel.total || 0);
  const offset = Number(viewModel.offset || 0);
  const limit = Number(viewModel.limit || 20);
  const results = Array.isArray(viewModel.results) ? viewModel.results : [];
  const queue = Array.isArray(viewModel.queue) ? viewModel.queue : [];
  const startLabel = total > 0 ? Math.min(offset + 1, total) : 0;
  const endLabel = total > 0 ? Math.min(offset + results.length, total) : results.length;
  const difficultyOptions = ["", "Low", "Mid", "High"];
  const difficultyLabels = { "": "全部难度", Low: "Low", Mid: "Mid", High: "High" };
  const serialized = JSON.stringify({
    query: viewModel.query || "",
    difficulty: viewModel.difficulty || "",
    tag: viewModel.tag || "",
    limit,
    offset
  });
  const resultTable = renderProblemsetTable(results, viewModel.state, viewModel.baseUrl);
  const queueTable = renderProblemsetQueueTable(queue, viewModel.state, viewModel.baseUrl);
  const activeProblem = viewModel.activeProblem ? `<div class="active-problem"><span class="status-pill accent">当前题</span><strong>${escapeHtml(viewModel.activeProblem.display_id)} ${escapeHtml(viewModel.activeProblem.title)}</strong></div>` : "";
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17312f; background: radial-gradient(circle at top left, #f7ead2 0%, #f8f7f2 35%, #eef5f0 100%); }
        .shell { max-width: 1280px; margin: 0 auto; padding: 24px; }
        .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.7fr); gap: 20px; align-items: end; }
        h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; }
        .subtitle { margin: 0; color: #526b66; line-height: 1.6; }
        .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .stat { background: rgba(255,255,255,0.75); border: 1px solid rgba(23,49,47,0.08); border-radius: 18px; padding: 14px 16px; backdrop-filter: blur(16px); }
        .stat-value { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
        .stat-label { font-size: 12px; color: #5a706b; }
        .panel { margin-top: 18px; background: rgba(255,255,255,0.78); border: 1px solid rgba(23,49,47,0.08); border-radius: 22px; padding: 18px; box-shadow: 0 12px 36px rgba(23,49,47,0.06); backdrop-filter: blur(16px); }
        .toolbar { display: grid; grid-template-columns: 1.4fr 0.6fr 0.9fr 0.5fr auto; gap: 10px; align-items: end; }
        .field label { display: block; font-size: 12px; color: #5a706b; margin-bottom: 6px; }
        .field input, .field select { width: 100%; box-sizing: border-box; border: 1px solid rgba(23,49,47,0.12); border-radius: 12px; padding: 11px 12px; font: inherit; background: #fff; color: #17312f; }
        .toolbar button, .problem-card-actions button, .queue-card-actions button, .nav-buttons button, .problem-cell-actions button { border: 1px solid rgba(23,49,47,0.12); border-radius: 10px; padding: 7px 10px; background: #fff; color: #17312f; cursor: pointer; font-size: 12px; line-height: 1.2; transition: transform 0.16s ease, box-shadow 0.16s ease; }
        .toolbar button:hover, .problem-card-actions button:hover, .queue-card-actions button:hover, .nav-buttons button:hover, .problem-cell-actions button:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(23,49,47,0.08); }
        .toolbar button.primary, .problem-card-actions button.primary, .queue-card-actions button.primary, .nav-buttons button.primary, .problem-cell-actions button.primary { background: linear-gradient(135deg, #0b5d5b 0%, #1e7d61 100%); color: #f7f7f2; border-color: transparent; }
        .toolbar-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
        .section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
        .section-head h2 { margin: 0; font-size: 18px; }
        .section-head p { margin: 0; color: #56706a; font-size: 13px; }
        .nav-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        .panel-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.9fr); gap: 18px; margin-top: 18px; }
        .table-shell { overflow-x: auto; border: 1px solid rgba(23,49,47,0.08); border-radius: 18px; background: #fff; }
        .problem-table { width: 100%; border-collapse: collapse; min-width: 860px; }
        .queue-table { min-width: 620px; }
        .problem-table thead th { text-align: left; font-size: 12px; font-weight: 700; color: #5a706b; padding: 10px 12px; background: #f7f8f6; border-bottom: 1px solid rgba(23,49,47,0.08); }
        .problem-table tbody td { padding: 10px 12px; border-bottom: 1px solid rgba(23,49,47,0.06); vertical-align: top; }
        .problem-table tbody tr:hover { background: rgba(215,235,229,0.28); }
        .problem-cell-code { white-space: nowrap; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #7a8d86; width: 74px; }
        .problem-cell-title strong { display: block; font-size: 15px; margin-bottom: 6px; }
        .problem-title-wrap { min-width: 0; }
        .problem-subtitle { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
        .problem-cell-meta { white-space: nowrap; color: #36514c; font-size: 13px; }
        .problem-cell-tags { min-width: 120px; }
        .problem-cell-actions { white-space: nowrap; width: 108px; padding-right: 4px; }
        .problem-cell-actions button { margin: 0 4px 0 0; }
        .problem-cell-actions .icon-only { width: 30px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; }
        .problem-cell-actions .icon-only svg { width: 14px; height: 14px; display: block; }
        .problem-table tbody td.problem-cell-actions { padding-right: 4px; }
        .problem-table tbody td.problem-cell-code { padding-left: 6px; }
        .problem-code { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #7a8d86; }
        .problem-card-meta, .problem-card-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        .problem-card-actions, .queue-card-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
        .meta-pill, .status-pill, .tag { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px; font-size: 11px; background: #d7ebe5; color: #17312f; }
        .status-pill.accent, .meta-pill.accent { background: #ffe7c5; color: #8b4d08; }
        .tag { background: #f2f5f3; color: #5d736d; }
        .tag.muted { background: #f2f5f3; color: #5d736d; }
        .empty { padding: 20px; border: 1px dashed rgba(23,49,47,0.18); border-radius: 18px; color: #5a706b; background: rgba(255,255,255,0.5); }
        .error { margin-top: 12px; padding: 12px 14px; border-radius: 14px; background: #ffe8e6; color: #8d342b; border: 1px solid #efc1bc; }
        .active-problem { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
        .workspace-tip { margin-top: 10px; color: #5a706b; font-size: 13px; }
        .loading { margin-top: 10px; color: #5a706b; }
        @media (max-width: 980px) {
          .hero, .toolbar, .panel-grid { grid-template-columns: 1fr; }
          .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .section-head, .problem-card-top { flex-direction: column; align-items: flex-start; }
          .problem-cell-actions { white-space: normal; }
          .problem-cell-tags { min-width: 0; }
          .problem-table { min-width: 760px; }
          .queue-table { min-width: 560px; }
          .toolbar-actions { justify-content: flex-start; }
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <div class="hero">
          <div>
            <h1>公共题库刷题台</h1>
            <p class="subtitle">在这里搜索、筛选、编排和连续刷题。把题目加进队列后，可以直接开刷、跳到下一题，或者随机抽题继续。</p>
            ${activeProblem}
          </div>
          <div class="stats">
            <div class="stat"><div class="stat-value">${escapeHtml(String(total))}</div><div class="stat-label">当前结果数</div></div>
            <div class="stat"><div class="stat-value">${escapeHtml(String(queue.length))}</div><div class="stat-label">刷题队列</div></div>
            <div class="stat"><div class="stat-value">${escapeHtml(String(startLabel))}</div><div class="stat-label">当前页起始</div></div>
            <div class="stat"><div class="stat-value">${escapeHtml(String(limit))}</div><div class="stat-label">每页题数</div></div>
          </div>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>搜索与筛选</h2>
              <p>支持题号、标题、难度和标签筛选。搜索结果可直接加入队列或开刷。</p>
            </div>
            <div class="nav-buttons">
              <button type="button" data-command="nextQueue">继续下一题</button>
              <button type="button" data-command="randomQueue">随机一题</button>
              <button type="button" data-command="clearQueue">清空队列</button>
            </div>
          </div>
          <form class="toolbar" id="search-form">
            <div class="field">
              <label>关键词</label>
              <input id="problemset-keyword" name="keyword" type="text" placeholder="题号 / 标题" value="${escapeHtml(viewModel.query || "")}" />
            </div>
            <div class="field">
              <label>难度</label>
              <select id="problemset-difficulty" name="difficulty">
                ${difficultyOptions.map((item) => `<option value="${escapeHtml(item)}" ${String(item) === String(viewModel.difficulty || "") ? "selected" : ""}>${escapeHtml(difficultyLabels[item])}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>标签</label>
              <input id="problemset-tag" name="tag" type="text" placeholder="例如 dp / graph" value="${escapeHtml(viewModel.tag || "")}" />
            </div>
            <div class="field">
              <label>每页</label>
              <select id="problemset-limit" name="limit">
                ${[10, 20, 30, 50].map((item) => `<option value="${item}" ${Number(item) === Number(limit) ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </div>
            <div class="toolbar-actions">
              <button type="submit" class="primary">搜索</button>
              <button type="button" data-command="prevPage">上一页</button>
              <button type="button" data-command="nextPage">下一页</button>
            </div>
          </form>
          ${viewModel.loading ? '<div class="loading">正在加载题库…</div>' : ""}
          ${viewModel.error ? `<div class="error">${escapeHtml(viewModel.error)}</div>` : ""}
        </div>

        <div class="panel-grid">
          <section class="panel">
            <div class="section-head">
              <div>
                <h2>搜索结果</h2>
                <p>${results.length ? `当前显示第 ${startLabel} - ${endLabel} 题` : "没有匹配题目"}</p>
              </div>
              <div class="nav-buttons">
                <button type="button" data-command="reloadSearch">重新加载</button>
              </div>
            </div>
            ${resultTable}
          </section>

          <section class="panel">
            <div class="section-head">
              <div>
                <h2>刷题队列</h2>
                <p>按加入顺序连续刷题。每道题都能单独打开、移除或直接开刷。</p>
              </div>
              <div class="nav-buttons">
                <button type="button" data-command="queueToTop">优先下一题</button>
              </div>
            </div>
            ${queueTable}
          </section>
        </div>
      </div>
      <script type="application/json" id="problemset-workbench-state">${escapeHtml(serialized)}</script>
      <script>
        const vscode = acquireVsCodeApi();
        const currentStateElement = document.getElementById("problemset-workbench-state");
        let current = { limit: 20 };
        try {
          current = JSON.parse(currentStateElement ? currentStateElement.textContent || "{}" : "{}");
        } catch (error) {
          current = { limit: 20 };
        }
        function send(command, payload = {}) {
          vscode.postMessage(Object.assign({ command }, payload));
        }
        window.addEventListener("error", (event) => {
          const shell = document.querySelector(".shell");
          if (!shell) {
            return;
          }
          const error = document.createElement("div");
          error.className = "error";
          error.textContent = "刷题台脚本错误：" + (event.message || "未知错误");
          shell.insertBefore(error, shell.firstChild);
        });
        document.getElementById("search-form").addEventListener("submit", (event) => {
          event.preventDefault();
          send("search", {
            query: document.getElementById("problemset-keyword").value.trim(),
            difficulty: document.getElementById("problemset-difficulty").value,
            tag: document.getElementById("problemset-tag").value.trim(),
            limit: Number(document.getElementById("problemset-limit").value) || current.limit || 20,
            offset: 0
          });
        });
        document.querySelectorAll("[data-command]").forEach((button) => {
          button.addEventListener("click", () => {
            const command = button.getAttribute("data-command");
            const encoded = button.getAttribute("data-problem");
            let payload = {};
            if (encoded) {
              try {
                payload = JSON.parse(encoded);
              } catch (error) {
                payload = {};
              }
            }
            send(command, payload);
          });
        });
      </script>
    </body>
  </html>`;
}

function getProblemsetWorkbenchState(state) {
  if (!state.problemsetWorkbench) {
    state.problemsetWorkbench = {
      query: "",
      difficulty: "",
      tag: "",
      limit: 20,
      offset: 0,
      total: 0,
      results: [],
      loading: false,
      error: null
    };
  }
  return state.problemsetWorkbench;
}

function buildProblemsetWorkbenchViewModel(state, client) {
  const workbench = getProblemsetWorkbenchState(state);
  return {
    query: workbench.query || "",
    difficulty: workbench.difficulty || "",
    tag: workbench.tag || "",
    limit: workbench.limit || 20,
    offset: workbench.offset || 0,
    total: workbench.total || 0,
    results: workbench.results || [],
    loading: Boolean(workbench.loading),
    error: workbench.error || null,
    queue: state.problemsetSelections || [],
    activeProblem: state.activeProblem && !state.activeContest ? state.activeProblem : null,
    state,
    baseUrl: client.baseUrl
  };
}

async function refreshProblemsetWorkbenchPanel(state, client) {
  if (!state.problemsetPanel) {
    return;
  }
  state.problemsetPanel.title = "XMUOJ 公共题库刷题台";
  state.problemsetPanel.webview.html = renderProblemsetWorkbenchHtml(buildProblemsetWorkbenchViewModel(state, client));
}

async function loadProblemsetWorkbenchResults(context, client, state, treeProvider, params = {}) {
  const workbench = getProblemsetWorkbenchState(state);
  const nextState = Object.assign({}, workbench, {
    query: params.query !== undefined ? params.query : workbench.query,
    difficulty: params.difficulty !== undefined ? params.difficulty : workbench.difficulty,
    tag: params.tag !== undefined ? params.tag : workbench.tag,
    limit: params.limit !== undefined ? Number(params.limit) || 20 : workbench.limit || 20,
    offset: params.offset !== undefined ? Math.max(0, Number(params.offset) || 0) : workbench.offset || 0,
    loading: true,
    error: null
  });
  state.problemsetWorkbench = nextState;
  await refreshProblemsetWorkbenchPanel(state, client);
  try {
    const response = await client.getProblemset({
      keyword: nextState.query || undefined,
      difficulty: nextState.difficulty || undefined,
      tag: nextState.tag || undefined,
      limit: nextState.limit,
      offset: nextState.offset
    });
    state.problemsetWorkbench = Object.assign({}, nextState, {
      loading: false,
      error: null,
      total: Number(response.count || response.total || (response.results && response.results.length) || 0),
      results: response.results || []
    });
    await refreshProblemsetWorkbenchPanel(state, client);
    if (treeProvider) {
      treeProvider.refresh();
    }
    return state.problemsetWorkbench;
  } catch (error) {
    state.problemsetWorkbench = Object.assign({}, nextState, {
      loading: false,
      error: error.message || String(error),
      results: []
    });
    await refreshProblemsetWorkbenchPanel(state, client);
    throw error;
  }
}

async function openProblemsetWorkbench(context, client, state, treeProvider) {
  if (!state.problemsetPanel) {
    const panel = vscode.window.createWebviewPanel(
      "xmuojProblemsetWorkbench",
      "XMUOJ 公共题库刷题台",
      getProblemViewColumn(),
      { enableScripts: true, retainContextWhenHidden: true }
    );
    panel.webview.html = renderProblemsetWorkbenchSkeleton();
    panel.onDidDispose(() => {
      if (state.problemsetPanel === panel) {
        state.problemsetPanel = null;
      }
      if (typeof state.persistenceHook === "function") {
        state.persistenceHook().catch(() => null);
      }
    });
    state.problemsetPanel = panel;
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        const payload = message && message.problem ? message.problem : (message && message.id ? message : null);
        if (message.command === "search") {
          await loadProblemsetWorkbenchResults(context, client, state, treeProvider, {
            query: message.query || "",
            difficulty: message.difficulty || "",
            tag: message.tag || "",
            limit: message.limit || 20,
            offset: 0
          });
        } else if (message.command === "reloadSearch") {
          const workbench = getProblemsetWorkbenchState(state);
          await loadProblemsetWorkbenchResults(context, client, state, treeProvider, {
            query: workbench.query,
            difficulty: workbench.difficulty,
            tag: workbench.tag,
            limit: workbench.limit,
            offset: workbench.offset
          });
        } else if (message.command === "nextPage") {
          const workbench = getProblemsetWorkbenchState(state);
          const nextOffset = Math.max(0, (workbench.offset || 0) + (workbench.limit || 20));
          if (workbench.total && nextOffset >= workbench.total) {
            vscode.window.showInformationMessage("已经是最后一页");
            return;
          }
          await loadProblemsetWorkbenchResults(context, client, state, treeProvider, { offset: nextOffset });
        } else if (message.command === "prevPage") {
          const workbench = getProblemsetWorkbenchState(state);
          const nextOffset = Math.max(0, (workbench.offset || 0) - (workbench.limit || 20));
          await loadProblemsetWorkbenchResults(context, client, state, treeProvider, { offset: nextOffset });
        } else if (message.command === "addQueue" && payload) {
          upsertProblemsetSelection(state, payload, client.baseUrl);
          await persistProblemsetSelections(context, state);
          treeProvider.refresh();
          await refreshProblemsetWorkbenchPanel(state, client);
        } else if (message.command === "removeQueueItem" && payload) {
          removeProblemsetSelection(state, payload);
          await persistProblemsetSelections(context, state);
          treeProvider.refresh();
          await refreshProblemsetWorkbenchPanel(state, client);
        } else if (message.command === "clearQueue") {
          const confirmed = await vscode.window.showWarningMessage("确定要清空公共题库刷题队列吗？", { modal: true }, "清空");
          if (confirmed !== "清空") {
            return;
          }
          clearProblemsetSelections(state);
          await persistProblemsetSelections(context, state);
          treeProvider.refresh();
          await refreshProblemsetWorkbenchPanel(state, client);
        } else if (message.command === "queueToTop") {
          const nextProblem = getNextProblemsetSelection(state, client.baseUrl) || (state.problemsetSelections || [])[0];
          if (!nextProblem) {
            vscode.window.showInformationMessage("当前队列为空");
            return;
          }
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, { id: nextProblem.id, display_id: nextProblem.display_id, title: nextProblem.title }, null, "");
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          if (treeProvider) {
            treeProvider.refresh();
          }
        } else if (message.command === "nextQueue") {
          const nextProblem = getNextProblemsetSelection(state, client.baseUrl);
          if (!nextProblem) {
            vscode.window.showInformationMessage("队列里还没有下一题");
            return;
          }
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, { id: nextProblem.id, display_id: nextProblem.display_id, title: nextProblem.title }, null, "");
          await startWorkingOnProblem(context, client, state, state.outputChannel, detail, null);
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          if (treeProvider) {
            treeProvider.refresh();
          }
        } else if (message.command === "randomQueue") {
          const randomProblem = getRandomProblemsetSelection(state, client.baseUrl);
          if (!randomProblem) {
            vscode.window.showInformationMessage("队列里还没有题目");
            return;
          }
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, { id: randomProblem.id, display_id: randomProblem.display_id, title: randomProblem.title }, null, "");
          await startWorkingOnProblem(context, client, state, state.outputChannel, detail, null);
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          if (treeProvider) {
            treeProvider.refresh();
          }
        } else if (message.command === "openProblem" && payload) {
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, payload, null, "");
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          if (treeProvider) {
            treeProvider.refresh();
          }
        } else if (message.command === "startProblem" && payload) {
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, payload, null, "");
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          await startWorkingOnProblem(context, client, state, state.outputChannel, detail, null);
          if (treeProvider) {
            treeProvider.refresh();
          }
        } else if (message.command === "openQueueItem" && payload) {
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, payload, null, "");
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          if (treeProvider) {
            treeProvider.refresh();
          }
        } else if (message.command === "startQueueItem" && payload) {
          clearContestContext(state);
          updateStatusBars(state, state.userStatusBar, state.contestStatusBar, client);
          const detail = await openProblemDetail(client, state, payload, null, "");
          upsertProblemsetSelection(state, detail, client.baseUrl);
          await persistProblemsetSelections(context, state);
          await startWorkingOnProblem(context, client, state, state.outputChannel, detail, null);
          if (treeProvider) {
            treeProvider.refresh();
          }
        }
      } catch (error) {
        await refreshProblemsetWorkbenchPanel(state, client);
        vscode.window.showErrorMessage(error.message || String(error));
      }
    });
  } else {
    state.problemsetPanel.reveal(getProblemViewColumn(), false);
  }
  if (!state.problemsetWorkbench || !Array.isArray(state.problemsetWorkbench.results) || !state.problemsetWorkbench.results.length) {
    try {
      await loadProblemsetWorkbenchResults(context, client, state, treeProvider, { offset: 0 });
    } catch (error) {
      state.problemsetWorkbench = Object.assign({}, getProblemsetWorkbenchState(state), {
        loading: false,
        error: error.message || String(error),
        results: []
      });
      await refreshProblemsetWorkbenchPanel(state, client);
    }
  } else {
    await refreshProblemsetWorkbenchPanel(state, client);
  }
  return state.problemsetPanel;
}

function getSubmissionStatusPresentation(result) {
  const label = String(result && result.result_label ? result.result_label : "").trim();
  const normalized = label.toLowerCase();
  const mapping = {
    pending: {
      tone: "warning",
      title: "等待评分",
      explanation: "您的解答将很快被测评，请等待结果。"
    },
    judging: {
      tone: "warning",
      title: "正在评分",
      explanation: "您的解答将很快被测评，请等待结果。"
    },
    'compile error': {
      tone: "danger",
      title: "编译失败",
      explanation: "无法编译您的源代码，点击下方链接查看编译器输出或原始判题详情。"
    },
    ce: {
      tone: "danger",
      title: "编译失败",
      explanation: "无法编译您的源代码，点击下方链接查看编译器输出或原始判题详情。"
    },
    accepted: {
      tone: "success",
      title: "答案正确",
      explanation: "你的解题方法是正确的。"
    },
    ac: {
      tone: "success",
      title: "答案正确",
      explanation: "你的解题方法是正确的。"
    },
    'wrong answer': {
      tone: "danger",
      title: "答案错误",
      explanation: "你的程序输出结果与判题程序的答案不符。"
    },
    wa: {
      tone: "danger",
      title: "答案错误",
      explanation: "你的程序输出结果与判题程序的答案不符。"
    },
    'runtime error': {
      tone: "danger",
      title: "运行时错误",
      explanation: "您的程序异常终止，可能的原因是：段错误，被零除或用非0的代码退出程序。"
    },
    re: {
      tone: "danger",
      title: "运行时错误",
      explanation: "您的程序异常终止，可能的原因是：段错误，被零除或用非0的代码退出程序。"
    },
    'time limit exceeded': {
      tone: "danger",
      title: "运行超时",
      explanation: "您的程序使用的 CPU 时间已超出限制。"
    },
    tle: {
      tone: "danger",
      title: "运行超时",
      explanation: "您的程序使用的 CPU 时间已超出限制。"
    },
    'memory limit exceeded': {
      tone: "danger",
      title: "内存超限",
      explanation: "程序实际使用的内存已超出限制。"
    },
    mle: {
      tone: "danger",
      title: "内存超限",
      explanation: "程序实际使用的内存已超出限制。"
    },
    'system error': {
      tone: "warning",
      title: "系统错误",
      explanation: "糟糕，判题程序出了问题。请报告给管理员。"
    },
    se: {
      tone: "warning",
      title: "系统错误",
      explanation: "糟糕，判题程序出了问题。请报告给管理员。"
    }
  };
  return mapping[normalized] || {
    tone: ACCEPTED_RESULTS.has(label) ? "success" : "warning",
    title: label || "评测结果",
    explanation: ACCEPTED_RESULTS.has(label) ? "你的解题方法是正确的。" : "请结合下面的错误信息和原始判题详情继续排查。"
  };
}

function getSubmissionVisualVariant(result) {
  const label = String(result && result.result_label ? result.result_label : "").trim().toLowerCase();
  if (ACCEPTED_RESULTS.has(String(result && result.result_label ? result.result_label : ""))) {
    return "accepted";
  }
  if (["compile error", "ce"].includes(label)) {
    return "compile";
  }
  if (["wrong answer", "wa"].includes(label)) {
    return "wrong-answer";
  }
  if (["runtime error", "re"].includes(label)) {
    return "runtime";
  }
  if (["time limit exceeded", "tle"].includes(label)) {
    return "timeout";
  }
  if (["memory limit exceeded", "mle"].includes(label)) {
    return "memory";
  }
  if (["system error", "se"].includes(label)) {
    return "system";
  }
  if (["pending", "judging"].includes(label)) {
    return "pending";
  }
  return "generic";
}

function asDiagnosticText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => asDiagnosticText(item)).filter(Boolean).join("\n").trim();
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function tryPickDiagnosticField(source, candidateKeys) {
  if (!source || typeof source !== "object") {
    return "";
  }
  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const text = asDiagnosticText(source[key]);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function stripPickedDiagnosticFields(source, pickedValues) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }
  const clone = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = asDiagnosticText(value);
    if (pickedValues.has(normalized) && normalized) {
      continue;
    }
    clone[key] = value;
  }
  return clone;
}

function extractSubmissionDiagnostics(result) {
  const stats = result && result.statistic_info && typeof result.statistic_info === "object"
    ? result.statistic_info
    : {};
  const infoObject = result && result.info && typeof result.info === "object" && !Array.isArray(result.info)
    ? result.info
    : null;

  const compileOutput = tryPickDiagnosticField(infoObject, [
    "compile_error",
    "compile_error_info",
    "compiler_output",
    "compile_output",
    "compileMessage",
    "stderr"
  ]);

  const errorSummary = [
    tryPickDiagnosticField(stats, ["err_info", "error", "message"]),
    tryPickDiagnosticField(infoObject, ["err_info", "error", "message", "error_message", "summary", "reason"]),
    typeof result.info === "string" ? asDiagnosticText(result.info) : ""
  ].find(Boolean) || "";

  const runtimeOutput = tryPickDiagnosticField(infoObject, [
    "stderr",
    "runtime_error",
    "runtime_output",
    "output",
    "stdout"
  ]);

  const pickedValues = new Set([compileOutput, errorSummary, runtimeOutput].filter(Boolean));
  const detailObject = infoObject ? stripPickedDiagnosticFields(infoObject, pickedValues) : null;
  const systemDetails = detailObject && Object.keys(detailObject).length
    ? asDiagnosticText(detailObject)
    : "";

  return {
    compileOutput,
    errorSummary,
    runtimeOutput,
    systemDetails,
    rawDetails: result && result.info
      ? asDiagnosticText(result.info)
      : ""
  };
}

function buildLocalFailureDiagnostics(report) {
  if (!report || !report.failed) {
    return "";
  }
  const failedCases = (report.results || []).filter((item) => !item.passed).slice(0, 3);
  if (!failedCases.length) {
    return `本地测试失败：${String(report.failed)} 个测试点失败。`;
  }
  return [
    `本地测试失败：${String(report.failed)} 个测试点失败，${String(report.passed || 0)}/${String(report.total || 0)} 通过。`,
    ...failedCases.map((item) => [
      `测试点 ${item.name}`,
      `期望输出:\n${item.expected || ""}`,
      `实际输出:\n${item.actual || ""}`,
      item.stderr ? `错误输出:\n${item.stderr}` : ""
    ].filter(Boolean).join("\n"))
  ].join("\n\n");
}

function buildSubmissionFailureDiagnostics(result) {
  if (!result || ACCEPTED_RESULTS.has(result.result_label)) {
    return "";
  }
  const normalizedLabel = String(result.result_label || "").trim().toLowerCase();
  if (normalizedLabel === "pending" || normalizedLabel === "judging") {
    return "";
  }
  const status = getSubmissionStatusPresentation(result);
  const diagnostics = extractSubmissionDiagnostics(result);
  return [
    `在线评测结果：${result.result_label || "未知"}`,
    `错误类型：${status.title}`,
    status.explanation ? `说明：${status.explanation}` : "",
    diagnostics.errorSummary ? `错误摘要：\n${diagnostics.errorSummary}` : "",
    diagnostics.compileOutput ? `编译输出：\n${diagnostics.compileOutput}` : "",
    diagnostics.runtimeOutput ? `运行输出：\n${diagnostics.runtimeOutput}` : "",
    diagnostics.systemDetails ? `系统详情：\n${diagnostics.systemDetails}` : ""
  ].filter(Boolean).join("\n\n");
}

function renderDiagnosticBlock(title, content, tone = "neutral", expanded = false) {
  if (!content) {
    return "";
  }
  return `
    <details class="diagnostic-block diagnostic-${tone}" ${expanded ? "open" : ""}>
      <summary>${escapeHtml(title)}</summary>
      <pre>${escapeHtml(content)}</pre>
    </details>`;
}

function renderSubmissionResultSection(result, baseUrl) {
  const stats = result.statistic_info || {};
  const status = getSubmissionStatusPresentation(result);
  const accepted = ACCEPTED_RESULTS.has(result.result_label);
  const diagnostics = extractSubmissionDiagnostics(result);
  const shouldExpandCompileOutput = status.title === "编译失败";
  const shouldExpandRuntimeOutput = !accepted && !shouldExpandCompileOutput && Boolean(diagnostics.runtimeOutput);
  const shouldExpandSystemDetails = !accepted && !shouldExpandCompileOutput && !shouldExpandRuntimeOutput && Boolean(diagnostics.systemDetails);
  const rawDetails = diagnostics.rawDetails
    ? `<details><summary>查看原始判题详情</summary><pre>${escapeHtml(diagnostics.rawDetails)}</pre></details>`
    : "";
  return `
      <section class="panel">
        <h2>在线评测详情</h2>
        <div class="detail-banner ${status.tone}">
          <strong>${escapeHtml(status.title)}</strong>
          <span>${escapeHtml(status.explanation)}</span>
        </div>
        <div class="pill-row">
          <span class="pill ${status.tone === "success" ? "pill-success" : status.tone === "danger" ? "pill-danger" : "pill-warning"}">${escapeHtml(result.result_label || "未知")}</span>
          <span class="pill">${escapeHtml(result.language)}</span>
          <span class="pill">${escapeHtml(result.displayId || result.display_id || "")}</span>
          <span class="pill">提交 #${escapeHtml(String(result.id))}</span>
        </div>
        <div class="facts">
          <div class="fact"><span class="fact-label">运行时间</span><strong>${escapeHtml(String(stats.time_cost || "无"))}</strong></div>
          <div class="fact"><span class="fact-label">内存占用</span><strong>${escapeHtml(String(stats.memory_cost || "无"))}</strong></div>
          <div class="fact"><span class="fact-label">得分</span><strong>${escapeHtml(String(stats.score || "无"))}</strong></div>
          <div class="fact"><span class="fact-label">提交时间</span><strong>${escapeHtml(String(result.submittedAt || "无"))}</strong></div>
        </div>
        ${accepted ? '<div class="callout success">这次在线提交已经 AC，在线评测部分没有遗留问题。</div>' : ""}
        ${!accepted && diagnostics.errorSummary ? `<div class="callout danger"><strong>错误摘要</strong><pre>${escapeHtml(diagnostics.errorSummary)}</pre></div>` : ""}
        ${status.title === "编译失败" ? renderDiagnosticBlock("编译输出", diagnostics.compileOutput || diagnostics.errorSummary, "danger", shouldExpandCompileOutput) : ""}
        ${status.title !== "编译失败" && diagnostics.runtimeOutput ? renderDiagnosticBlock("错误输出", diagnostics.runtimeOutput, "warning", shouldExpandRuntimeOutput) : ""}
        ${diagnostics.systemDetails ? renderDiagnosticBlock("系统返回详情", diagnostics.systemDetails, "neutral", shouldExpandSystemDetails) : ""}
        ${!accepted && !diagnostics.errorSummary && !diagnostics.compileOutput && !diagnostics.runtimeOutput && !diagnostics.systemDetails ? '<div class="callout warning">站点没有返回更具体的失败原因。可以结合本地测试和原始判题详情继续排查。</div>' : ""}
        <p><a href="${baseUrl}">打开 XMUOJ 站点</a></p>
        ${rawDetails}
      </section>`;
}

function renderLocalReportSection(report, baseUrl) {
  const failedCases = (report.results || []).filter((item) => !item.passed);
  const renderCaseBlock = (item) => `
    <div class="case-block fail-case">
      <div class="case-header">
        <strong>测试点 ${escapeHtml(item.name)}</strong>
        <span class="pill ${item.passed ? "pill-success" : "pill-danger"}">${item.passed ? "通过" : "失败"}</span>
        <span class="pill">退出码 ${escapeHtml(String(item.exitCode))}</span>
      </div>
      <div class="case-grid">
        <div>
          <h4>期望输出</h4>
          <pre>${escapeHtml(item.expected || "")}</pre>
        </div>
        <div>
          <h4>实际输出</h4>
          <pre>${escapeHtml(item.actual || "")}</pre>
        </div>
      </div>
      ${item.stderr ? `<div><h4>错误输出</h4><pre>${escapeHtml(item.stderr)}</pre></div>` : ""}
    </div>`;
  const failedBlocks = failedCases.map((item) => renderCaseBlock(item)).join("");
  const allBlocks = (report.results || []).map((item) => renderCaseBlock(item)).join("");
  return `
      <section class="panel">
        <h2>本地测试详情</h2>
        <div class="detail-banner ${report.failed === 0 ? "success" : "danger"}">
          <strong>${report.failed === 0 ? "全部通过" : `有 ${escapeHtml(String(report.failed))} 个测试点失败`}</strong>
          <span>${report.failed === 0 ? "本地测试数据已经全部通过。" : "请先处理失败测试点并重新运行本地测试。"}</span>
        </div>
        <div class="pill-row">
          <span class="pill">${escapeHtml(report.displayId || "未知题号")}</span>
          <span class="pill">${escapeHtml(report.language || "未知语言")}</span>
          <span class="pill ${report.failed === 0 ? "pill-success" : "pill-danger"}">${escapeHtml(String(report.passed || 0))}/${escapeHtml(String(report.total || 0))} 通过</span>
        </div>
        <div class="facts">
          <div class="fact"><span class="fact-label">通过</span><strong>${escapeHtml(String(report.passed || 0))}</strong></div>
          <div class="fact"><span class="fact-label">失败</span><strong>${escapeHtml(String(report.failed || 0))}</strong></div>
          <div class="fact"><span class="fact-label">测试目录</span><strong>${escapeHtml(report.caseDir || "无")}</strong></div>
          <div class="fact"><span class="fact-label">判题站点</span><strong><a href="${baseUrl}">${escapeHtml(baseUrl)}</a></strong></div>
        </div>
        ${report.failed === 0 ? '<div class="callout success">本地样例或测试数据已经全部通过。</div>' : ""}
        ${report.failed > 0 ? `<h3>失败测试点</h3>${failedBlocks}` : ""}
        <details class="all-cases-toggle" ${report.failed === 0 ? "open" : ""}>
          <summary>${report.failed > 0 ? `显示全部测试点（${escapeHtml(String(report.total || 0))}）` : `查看全部测试点（${escapeHtml(String(report.total || 0))}）`}</summary>
          ${allBlocks}
        </details>
      </section>`;
}

function getLocalResultPresentation(report) {
  if (!report) {
    return null;
  }
  if (report.failed === 0) {
    return {
      tone: "success",
      eyebrow: "本地测试",
      headline: "全部通过",
      message: `共 ${escapeHtml(String(report.total || 0))} 个测试点，当前本地结果稳定。`
    };
  }
  return {
    tone: "danger",
    eyebrow: "本地测试",
    headline: `${escapeHtml(String(report.failed || 0))} 个测试点失败`,
    message: `已通过 ${escapeHtml(String(report.passed || 0))}/${escapeHtml(String(report.total || 0))}，先看下面的失败详情。`
  };
}

function getSubmissionResultPresentationForSpotlight(result) {
  if (!result) {
    return null;
  }
  const status = getSubmissionStatusPresentation(result);
  const variant = getSubmissionVisualVariant(result);
  return {
    tone: status.tone,
    variant,
    eyebrow: "在线评测",
    headline: escapeHtml(status.title),
    message: escapeHtml(status.explanation),
    statusLabel: escapeHtml(result.result_label || "未知")
  };
}

function renderResultSpotlight(viewModel) {
  const { problemRef, localReport, submissionResult } = viewModel;
  const primary = getLocalResultPresentation(localReport) || getSubmissionResultPresentationForSpotlight(submissionResult);
  if (!primary) {
    return `
      <section class="spotlight spotlight-empty panel">
        <div class="spotlight-copy">
          <div class="spotlight-eyebrow">当前题结果</div>
          <h2>还没有结果</h2>
          <p>先运行一次本地测试或提交代码，结果报表才会出现可读的结果卡片和详情。</p>
        </div>
      </section>`;
  }
  const titleLine = problemRef
    ? `${escapeHtml(problemRef.displayId || "")} ${escapeHtml(problemRef.title || "")}`.trim()
    : "当前题目";
  const accent = primary.tone === "success"
    ? "spotlight-success"
    : primary.variant
      ? `spotlight-${primary.variant}`
      : (primary.tone === "danger" ? "spotlight-danger" : "spotlight-warning");
  const celebration = primary.tone === "success"
    ? '<div class="spotlight-badge">AC</div><div class="spotlight-confetti"><span></span><span></span><span></span><span></span><span></span></div><div class="spotlight-rays"></div>'
    : primary.tone === "danger"
      ? `<div class="spotlight-badge">${primary.variant === "compile" ? "CE" : primary.variant === "wrong-answer" ? "WA" : primary.variant === "runtime" ? "RE" : primary.variant === "timeout" ? "TLE" : primary.variant === "memory" ? "MLE" : "FAIL"}</div><div class="spotlight-signal ${primary.variant || "generic"}"></div>`
      : '<div class="spotlight-badge">INFO</div>';
  return `
    <section class="spotlight ${accent}">
      <div class="spotlight-copy">
        <div class="spotlight-eyebrow">${primary.eyebrow}</div>
        <h2>${primary.headline}</h2>
        <p>${primary.message}</p>
        <div class="spotlight-meta">
          <span class="pill ${primary.tone === "success" ? "pill-success" : primary.tone === "danger" ? "pill-danger" : "pill-warning"}">${primary.eyebrow}</span>
          ${localReport ? `<span class="pill ${localReport.failed === 0 ? "pill-success" : "pill-danger"}">本地 ${escapeHtml(String(localReport.passed || 0))}/${escapeHtml(String(localReport.total || 0))}</span>` : ""}
          ${submissionResult ? `<span class="pill ${ACCEPTED_RESULTS.has(submissionResult.result_label) ? "pill-success" : "pill-danger"}">在线 ${escapeHtml(submissionResult.result_label || "未知")}</span>` : ""}
          <span class="pill">${titleLine || "当前题目"}</span>
        </div>
      </div>
      <div class="spotlight-art" aria-hidden="true">
        ${celebration}
      </div>
    </section>`;
}

function renderResultOverviewCards(localReport, submissionResult) {
  const cards = [];
  if (localReport) {
    cards.push(`
      <div class="overview-card ${localReport.failed === 0 ? "success" : "danger"}">
        <div class="overview-label">本地测试</div>
        <strong>${localReport.failed === 0 ? "已通过" : "需修复"}</strong>
        <span>${escapeHtml(String(localReport.passed || 0))}/${escapeHtml(String(localReport.total || 0))} 通过</span>
      </div>`);
  }
  if (submissionResult) {
    const accepted = ACCEPTED_RESULTS.has(submissionResult.result_label);
    const variant = getSubmissionVisualVariant(submissionResult);
    cards.push(`
      <div class="overview-card ${accepted ? "success" : `danger ${variant}`} ">
        <div class="overview-label">在线评测</div>
        <strong>${escapeHtml(submissionResult.result_label || "未知")}</strong>
        <span>${escapeHtml(submissionResult.language || "未知语言")}</span>
      </div>`);
  }
  if (!cards.length) {
    return '<div class="callout warning">这道题还没有结果记录。</div>';
  }
  return `<div class="overview-grid">${cards.join("")}</div>`;
}

function renderResultPanelHistoryTools(problemRef, focusMode, historyCount, historyNavigation) {
  if (!problemRef || !(historyCount > 0 || focusMode === "history-submission")) {
    return "";
  }
  return `
    <section class="panel">
      <h2>历史结果</h2>
      <div class="actions result-actions">
        ${focusMode === "history-submission" ? renderActionButton("showLatestResult", "showResults", "当前题最新结果", "secondary") : ""}
        ${focusMode === "history-submission" && historyNavigation && historyNavigation.newer ? renderActionButton("showNewerHistoryResult", "showResults", "上一条历史", "secondary") : ""}
        ${focusMode === "history-submission" && historyNavigation && historyNavigation.older ? renderActionButton("showOlderHistoryResult", "showResults", "下一条历史", "secondary") : ""}
        ${historyCount > 0 ? renderActionButton("pickHistoryResult", "showResults", `历史提交结果${historyCount > 1 ? ` (${escapeHtml(String(historyCount))})` : ""}`, "secondary") : ""}
      </div>
    </section>`;
}
function buildResultProblemRefFromMetadata(metadata) {
  if (!metadata || !metadata.problemId) {
    return null;
  }
  return {
    baseUrl: metadata.baseUrl || "",
    contestId: metadata.contestId || null,
    problemId: metadata.problemId,
    displayId: metadata.displayId || "",
    title: metadata.title || ""
  };
}

function buildResultProblemRefFromRecord(record) {
  if (!record) {
    return null;
  }
  if (!record.problemId && !record.displayId && !record.display_id && !record.title) {
    return null;
  }
  return {
    baseUrl: record.baseUrl || "",
    contestId: record.contestId || null,
    problemId: record.problemId || null,
    displayId: record.displayId || record.display_id || "",
    title: record.title || ""
  };
}

function buildResultProblemRefFromPayload(payload, state, client) {
  if (!payload || !payload.problem || !payload.problem.id) {
    return null;
  }
  const problem = payload.problem;
  const contest = payload.contest || null;
  return {
    baseUrl: payload.baseUrl || state.baseUrl || client.baseUrl,
    contestId: contest && contest.id ? contest.id : null,
    problemId: problem.id,
    displayId: problem.display_id || "",
    title: problem.title || ""
  };
}



function isSameResultProblem(left, right) {
  if (!left || !right) {
    return false;
  }
  const leftHasProblemId = Boolean(left.problemId);
  const rightHasProblemId = Boolean(right.problemId);
  if (leftHasProblemId && rightHasProblemId) {
    return String(left.problemId) === String(right.problemId)
      && String(left.contestId || "") === String(right.contestId || "")
      && String(left.baseUrl || "") === String(right.baseUrl || "");
  }
  if (leftHasProblemId !== rightHasProblemId) {
    return false;
  }
  // 仅在双方都缺少 problemId 时，才允许按 displayId/title 回退匹配
  if (!(left.displayId || left.title || right.displayId || right.title)) {
    return false;
  }
  return String(left.displayId || "") === String(right.displayId || "")
    && String(left.title || "") === String(right.title || "")
    && String(left.baseUrl || "") === String(right.baseUrl || "");
}

function pickSubmissionResultForProblem(state, problemRef, explicitSubmission) {
  if (explicitSubmission) {
    return explicitSubmission;
  }
  if (!problemRef) {
    return state.lastSubmissionResult || null;
  }
  if (isSameResultProblem(buildResultProblemRefFromRecord(state.lastSubmissionResult), problemRef)) {
    return state.lastSubmissionResult;
  }
  return (state.submissionHistory || []).find((item) => isSameResultProblem(buildResultProblemRefFromRecord(item), problemRef)) || null;
}

function pickLocalReportForProblem(state, problemRef) {
  if (!problemRef) {
    return state.lastLocalReport || null;
  }
  return isSameResultProblem(buildResultProblemRefFromRecord(state.lastLocalReport), problemRef)
    ? state.lastLocalReport
    : null;
}

function getSubmissionHistoryForProblem(state, problemRef) {
  if (!problemRef) {
    return state.submissionHistory || [];
  }
  return (state.submissionHistory || []).filter((item) => isSameResultProblem(buildResultProblemRefFromRecord(item), problemRef));
}

function getHistorySubmissionNavigation(state, problemRef, currentSubmission) {
  const history = getSubmissionHistoryForProblem(state, problemRef);
  if (!currentSubmission || !currentSubmission.id) {
    return { history, index: -1, newer: null, older: null };
  }
  const index = history.findIndex((item) => String(item.id) === String(currentSubmission.id));
  return {
    history,
    index,
    newer: index > 0 ? history[index - 1] : null,
    older: index >= 0 && index < history.length - 1 ? history[index + 1] : null
  };
}

async function resolveResultPanelProblemRef(client, state) {
  if (state.resultPanelFocus && state.resultPanelFocus.problemRef) {
    return state.resultPanelFocus.problemRef;
  }
  if (state.activeProblem && state.activeProblem.id) {
    return {
      baseUrl: state.baseUrl || client.baseUrl,
      contestId: state.activeContest && state.activeContest.id ? state.activeContest.id : null,
      problemId: state.activeProblem.id,
      displayId: state.activeProblem.display_id || "",
      title: state.activeProblem.title || ""
    };
  }
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const metadataContext = await getEditorProblemContext(client, activeEditor.document);
    if (metadataContext.metadata) {
      return buildResultProblemRefFromMetadata(metadataContext.metadata);
    }
  }
  return buildResultProblemRefFromRecord(state.lastLocalReport)
    || buildResultProblemRefFromRecord(state.lastSubmissionResult);
}

function renderResultPanelHtml(viewModel) {
  const { problemRef, localReport, submissionResult, focusMode, historyCount, historyNavigation } = viewModel;
  const titleLine = problemRef
    ? `${escapeHtml(problemRef.displayId || "")} ${escapeHtml(problemRef.title || "")}`.trim()
    : "当前题目";
  const modeBanner = focusMode === "history-submission"
    ? '<div class="callout warning"><strong>历史提交结果</strong><div>你当前查看的是一条历史提交记录，但仍然使用同一套当前题结果报表展示。</div></div>'
    : "";
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 24px; background: linear-gradient(180deg, #f3efe3 0%, #f7f7f2 100%); color: #17312f; }
        h1, h2, h3, h4 { color: #0b5d5b; }
        .subtitle { color: #486563; margin-top: -8px; margin-bottom: 16px; }
        .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 8px; align-items: stretch; }
        .action-button { border: 0; border-radius: 20px; padding: 12px 10px; background: #0b5d5b; color: #f7f7f2; cursor: pointer; font-size: 14px; }
        .action-button.secondary { background: #d7ebe5; color: #17312f; }
        .icon-button { min-height: 82px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; line-height: 1; box-shadow: 0 4px 16px rgba(11, 93, 91, 0.08); border: 1px solid rgba(11, 93, 91, 0.08); }
        .icon-button.primary { background: #0b5d5b; color: #f7f7f2; }
        .icon-button:hover { transform: translateY(-1px); }
        .action-button-icon { display: inline-flex; width: 24px; height: 24px; }
        .action-button-icon svg { width: 24px; height: 24px; display: block; }
        .action-button-label { font-size: 12px; line-height: 1.2; font-weight: 600; text-align: center; }
        .pill { display: inline-block; background: #d7ebe5; border-radius: 999px; padding: 6px 12px; margin-right: 8px; margin-bottom: 8px; }
        .pill-row { margin: 8px 0 2px; }
        .pill-success { background: #d9efe1; color: #145a32; }
        .pill-danger { background: #f7dddb; color: #8f2d21; }
        .pill-warning { background: #fff1cf; color: #7d5a00; }
        .panel { background: rgba(255,255,255,0.78); border: 1px solid #d5ddd4; border-radius: 16px; padding: 18px; margin-bottom: 18px; }
        .spotlight { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(180px, 0.9fr); gap: 18px; border-radius: 24px; padding: 24px; margin-bottom: 18px; border: 1px solid transparent; }
        .spotlight-success { background: radial-gradient(circle at top left, rgba(255,255,255,0.96), rgba(225,246,230,0.98) 48%, rgba(191,233,205,0.98)); border-color: #b6dcc2; box-shadow: 0 20px 50px rgba(33, 111, 67, 0.14); }
        .spotlight-danger { background: radial-gradient(circle at top left, rgba(255,255,255,0.92), rgba(252,232,228,0.98) 55%, rgba(244,203,196,0.98)); border-color: #e8c1bc; box-shadow: 0 20px 50px rgba(141, 45, 33, 0.10); }
        .spotlight-warning { background: radial-gradient(circle at top left, rgba(255,255,255,0.92), rgba(255,244,219,0.98) 55%, rgba(247,226,166,0.98)); border-color: #efd48e; box-shadow: 0 20px 50px rgba(125, 90, 0, 0.10); }
        .spotlight-compile { background: radial-gradient(circle at top left, rgba(255,255,255,0.94), rgba(252,233,228,0.98) 48%, rgba(240,193,181,0.98)); border-color: #e7bbb2; }
        .spotlight-wrong-answer { background: radial-gradient(circle at top left, rgba(255,255,255,0.94), rgba(251,239,228,0.98) 48%, rgba(239,212,182,0.98)); border-color: #e5c8a2; }
        .spotlight-runtime { background: radial-gradient(circle at top left, rgba(255,255,255,0.94), rgba(248,232,236,0.98) 48%, rgba(228,191,202,0.98)); border-color: #debac5; }
        .spotlight-timeout { background: radial-gradient(circle at top left, rgba(255,255,255,0.94), rgba(255,242,220,0.98) 48%, rgba(244,219,169,0.98)); border-color: #e8d099; }
        .spotlight-memory { background: radial-gradient(circle at top left, rgba(255,255,255,0.94), rgba(239,236,252,0.98) 48%, rgba(207,199,239,0.98)); border-color: #c8c1e4; }
        .spotlight-system { background: radial-gradient(circle at top left, rgba(255,255,255,0.94), rgba(242,242,242,0.98) 48%, rgba(222,222,222,0.98)); border-color: #d0d0d0; }
        .spotlight-empty { padding: 24px; }
        .spotlight-copy { position: relative; z-index: 1; }
        .spotlight-eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #486563; margin-bottom: 10px; }
        .spotlight h2 { font-size: 34px; line-height: 1.05; margin: 0 0 10px; color: #114744; }
        .spotlight p { font-size: 16px; line-height: 1.6; margin: 0 0 16px; max-width: 42rem; }
        .spotlight-meta { display: flex; flex-wrap: wrap; gap: 8px; }
        .spotlight-art { position: relative; min-height: 160px; display: flex; align-items: center; justify-content: center; }
        .spotlight-badge { width: 128px; height: 128px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 800; letter-spacing: 0.08em; color: #fff; background: rgba(11, 93, 91, 0.92); box-shadow: 0 14px 30px rgba(11, 93, 91, 0.16); }
        .spotlight-danger .spotlight-badge { background: rgba(143, 45, 33, 0.92); }
        .spotlight-warning .spotlight-badge { background: rgba(125, 90, 0, 0.92); }
        .spotlight-confetti span { position: absolute; width: 18px; height: 18px; border-radius: 4px; opacity: 0.9; }
        .spotlight-confetti span:nth-child(1) { top: 18px; right: 24px; background: #0b5d5b; transform: rotate(18deg); }
        .spotlight-confetti span:nth-child(2) { bottom: 18px; left: 24px; background: #7fc89a; transform: rotate(-22deg); }
        .spotlight-confetti span:nth-child(3) { top: 54px; left: 18px; background: #c9a227; transform: rotate(34deg); }
        .spotlight-confetti span:nth-child(4) { bottom: 44px; right: 12px; background: #e67e22; transform: rotate(10deg); }
        .spotlight-confetti span:nth-child(5) { top: 10px; left: 52px; background: #2ecc71; transform: rotate(-18deg); }
        .spotlight-rays { position: absolute; inset: 6px; border-radius: 50%; background: repeating-conic-gradient(from 0deg, rgba(255,255,255,0.0) 0deg 10deg, rgba(255,255,255,0.22) 10deg 16deg); filter: blur(0.5px); }
        .spotlight-signal { position: absolute; inset: 20px; border-radius: 24px; border: 2px dashed rgba(143, 45, 33, 0.22); }
        .spotlight-signal.compile { border-color: rgba(143, 45, 33, 0.30); }
        .spotlight-signal.wrong-answer { border-color: rgba(156, 98, 32, 0.32); }
        .spotlight-signal.runtime { border-color: rgba(138, 57, 96, 0.30); }
        .spotlight-signal.timeout { border-color: rgba(160, 120, 28, 0.30); }
        .spotlight-signal.memory { border-color: rgba(94, 79, 168, 0.28); }
        .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
        .overview-card { border-radius: 16px; padding: 14px 16px; border: 1px solid #dde4da; background: #f8faf7; display: flex; flex-direction: column; gap: 6px; }
        .overview-card.success { background: #eef9f1; border-color: #cbe3d2; }
        .overview-card.danger { background: #fcedeb; border-color: #ebc4bf; }
        .overview-card.compile { background: #fbeae7; border-color: #e7bbb2; }
        .overview-card.wrong-answer { background: #fcf1e6; border-color: #e6c9a9; }
        .overview-card.runtime { background: #f8ecef; border-color: #debbc6; }
        .overview-card.timeout { background: #fff3df; border-color: #edd39d; }
        .overview-card.memory { background: #f0edfb; border-color: #d0c8ec; }
        .overview-card.system { background: #f1f1f1; border-color: #dadada; }
        .overview-label { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #58716e; }
        .detail-banner { display: flex; flex-direction: column; gap: 6px; border-radius: 14px; padding: 14px 16px; margin-bottom: 12px; }
        .detail-banner.success { background: #eaf6ee; border: 1px solid #c8e3d0; }
        .detail-banner.danger { background: #fae8e6; border: 1px solid #e8c1bc; }
        .detail-banner.warning { background: #fff4db; border: 1px solid #f0d188; }
        .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 14px 0; }
        .fact { background: #f6f8f5; border: 1px solid #dde4da; border-radius: 12px; padding: 12px; }
        .fact-label { display: block; color: #58716e; font-size: 12px; margin-bottom: 6px; }
        .callout { border-radius: 12px; padding: 12px 14px; margin: 14px 0; }
        .callout.success { background: #ebf7ef; border: 1px solid #c8e3d0; }
        .callout.warning { background: #fff4db; border: 1px solid #f0d188; }
        .callout.danger { background: #fbe8e6; border: 1px solid #e8c1bc; }
        .diagnostic-block { border-radius: 14px; padding: 14px; margin: 14px 0; border: 1px solid #dde4da; background: #f8faf7; }
        .diagnostic-danger { background: #fbebea; border-color: #e7c0bc; }
        .diagnostic-warning { background: #fff5df; border-color: #f0d188; }
        .diagnostic-neutral { background: #f6f8f5; border-color: #dde4da; }
        .diagnostic-block summary { cursor: pointer; font-weight: 700; color: #17312f; }
        .diagnostic-block[open] summary { margin-bottom: 10px; }
        .case-block { background: #fbfbf8; border: 1px solid #e1e6de; border-radius: 14px; padding: 14px; margin-bottom: 14px; }
        .case-header { margin-bottom: 10px; }
        .case-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
        .all-cases-toggle { margin-top: 16px; }
        .all-cases-toggle summary { cursor: pointer; font-weight: 700; color: #17312f; margin-bottom: 12px; }
        pre { white-space: pre-wrap; background: #132322; color: #f6f3ea; padding: 12px; border-radius: 12px; overflow: auto; margin: 0; }
        a { color: #9a3b2f; }
        details { margin-top: 14px; }
        summary { cursor: pointer; font-weight: 600; }
        @media (max-width: 720px) {
          .spotlight { grid-template-columns: 1fr; }
          .spotlight h2 { font-size: 28px; }
          .spotlight-art { min-height: 120px; }
          .spotlight-badge { width: 104px; height: 104px; font-size: 22px; }
        }
      </style>
    </head>
    <body>
      <h1>XMUOJ 当前题结果报表</h1>
      <p class="subtitle">${titleLine || "当前题目"}</p>
      ${modeBanner}
      ${renderResultSpotlight(viewModel)}
      <section class="panel">
        <h2>结果概览</h2>
        ${renderResultOverviewCards(localReport, submissionResult)}
      </section>
      ${localReport ? renderLocalReportSection(localReport, localReport.baseUrl || (problemRef ? problemRef.baseUrl : "") || "") : ""}
      ${submissionResult ? renderSubmissionResultSection(submissionResult, submissionResult.baseUrl || (problemRef ? problemRef.baseUrl : "") || "") : ""}
      ${renderResultPanelHistoryTools(problemRef, focusMode, historyCount, historyNavigation)}
      <script>
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('[data-command]').forEach((button) => {
          button.addEventListener('click', () => {
            vscode.postMessage({ command: button.getAttribute('data-command') });
          });
        });
      </script>
    </body>
  </html>`;
}

function updateStatusBars(state, userStatusBar, contestStatusBar, client) {
  state.baseUrl = client.baseUrl;
  userStatusBar.text = state.user ? `XMUOJ $(account) ${state.user.username}` : "XMUOJ $(circle-slash) 未登录";
  userStatusBar.tooltip = `XMUOJ 固定访问 ${client.baseUrl}（不在设置中修改）`;
  if (state.contestWorkspace && state.contestWorkspace.contest) {
    const contest = state.contestWorkspace.contest;
    const statusLabel = getContestStatusLabel(contest);
    contestStatusBar.text = `XMUOJ $(book) ${contest.title} [${statusLabel}]`;
    contestStatusBar.tooltip = `实验 #${contest.id} · 状态：${statusLabel}`;
  } else {
    contestStatusBar.text = "XMUOJ $(book) 未打开实验";
    contestStatusBar.tooltip = "先打开或浏览一个实验";
  }
}

async function waitForSubmission(client, submissionId) {
  const terminalStates = new Set(["Pending", "Judging"]);
  while (true) {
    const result = await client.getSubmission(submissionId);
    if (!terminalStates.has(result.result_label)) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

async function focusExplorerView() {
  try {
    await vscode.commands.executeCommand("xmuojExplorer.focus");
  } catch (error) {
    return;
  }
}

async function getEditorProblemContext(client, document) {
  if (!document) {
    return { metadata: null, metadataPath: null, problemDir: null };
  }
  const metadataEntry = await findProblemMetadata(document.fileName);
  if (!metadataEntry) {
    return { metadata: null, metadataPath: null, problemDir: null };
  }
  return {
    metadata: metadataEntry.metadata,
    metadataPath: metadataEntry.metadataPath,
    problemDir: path.dirname(metadataEntry.metadataPath)
  };
}

async function resolveSourceContext(client, state, problem = null, contest = null) {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const metadataContext = await getEditorProblemContext(client, activeEditor.document);
    if (metadataContext.metadata && metadataContext.problemDir) {
      return {
        document: activeEditor.document,
        metadataContext,
        sourcePath: activeEditor.document.fileName,
        usedActiveEditor: true
      };
    }
  }

  if (problem) {
    const targetContest = contest || (state.contestWorkspace ? state.contestWorkspace.contest : null);
    const existingWorkspace = await findExistingProblemWorkspace(problem, targetContest);
    if (existingWorkspace) {
      return {
        document: await vscode.workspace.openTextDocument(existingWorkspace.sourceFilePath),
        metadataContext: {
          metadata: existingWorkspace.metadata,
          metadataPath: existingWorkspace.metadataPath,
          problemDir: existingWorkspace.problemDir
        },
        sourcePath: existingWorkspace.sourceFilePath,
        usedActiveEditor: false
      };
    }
  }

  return null;
}

async function ensureProblemFromEditorContext(client, state) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  const metadataContext = await getEditorProblemContext(client, editor.document);
  if (!metadataContext.metadata) {
    return null;
  }
  const binding = await ensureValidProblemBinding(client, state, metadataContext);
  if (!binding.ok || !binding.detail) {
    return null;
  }
  const detail = binding.detail;
  if (state.problemPanel) {
    const contest = metadataContext.metadata.contestId
      ? {
          id: metadataContext.metadata.contestId,
          title: metadataContext.metadata.contestTitle || ""
        }
      : null;
    await refreshProblemPanel(state, client, detail, contest);
  }
  if (typeof state.persistenceHook === "function") {
    await state.persistenceHook();
  }
  return detail;
}

async function saveSubmissionHistory(context, state, result, metadata = {}) {
  const current = state.submissionHistory || [];
  const nextItem = Object.assign({}, result, {
    id: result.id,
    display_id: result.display_id || metadata.displayId || "",
    title: metadata.title || result.title || "",
    language: result.language || metadata.language || "",
    submittedAt: new Date().toLocaleString("zh-CN"),
    baseUrl: metadata.baseUrl || state.baseUrl,
    contestId: metadata.contestId || null,
    problemId: metadata.problemId || null
  });
  const next = [nextItem, ...current.filter((item) => item.id !== nextItem.id)].slice(0, 20);
  state.submissionHistory = next;
  await context.globalState.update(SUBMISSION_HISTORY_KEY, next);
  return next;
}

async function setSubmissionHistory(context, state, history) {
  state.submissionHistory = history;
  await context.globalState.update(SUBMISSION_HISTORY_KEY, history);
}

async function removeSubmissionHistoryEntry(context, state, submissionId) {
  const current = state.submissionHistory || [];
  const next = current.filter((item) => item.id !== submissionId);
  await setSubmissionHistory(context, state, next);
  if (state.lastSubmissionResult && state.lastSubmissionResult.id === submissionId) {
    state.lastSubmissionResult = null;
    await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, null);
  }
  return next;
}

async function clearSubmissionHistory(context, state) {
  await setSubmissionHistory(context, state, []);
  if (state.lastSubmissionResult) {
    state.lastSubmissionResult = null;
    await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, null);
  }
  state.resultPanelFocus = null;
}

async function manageSubmissionHistory(context, state, client, treeProvider) {
  const history = state.submissionHistory || [];
  if (!history.length) {
    vscode.window.showInformationMessage("最近提交历史里还没有记录");
    return;
  }

  const action = await vscode.window.showQuickPick([
    {
      label: "删除一条提交记录",
      description: `当前共 ${history.length} 条`,
      value: "delete-one"
    },
    {
      label: "清空全部提交历史",
      description: "删除所有最近提交记录",
      value: "clear-all"
    }
  ], {
    title: "管理最近提交历史",
    ignoreFocusOut: true
  });

  if (!action) {
    return;
  }

  if (action.value === "delete-one") {
    const target = await vscode.window.showQuickPick(history.map((item) => ({
      label: `#${item.id} ${item.result_label || ""}`.trim(),
      description: `${item.display_id || ""} ${item.title || ""}`.trim() || "提交记录",
      detail: [item.submittedAt || "", item.language || ""].filter(Boolean).join(" · "),
      item
    })), {
      title: "选择要删除的提交记录",
      ignoreFocusOut: true
    });
    if (!target) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `确定删除提交 #${target.item.id} 吗？`,
      { modal: true },
      "删除"
    );
    if (confirmed !== "删除") {
      return;
    }
    await removeSubmissionHistoryEntry(context, state, target.item.id);
    if (state.resultPanel) {
      await showResultPanel(state, client);
    }
    treeProvider.refresh();
    vscode.window.showInformationMessage(`已删除提交 #${target.item.id}`);
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `确定清空全部 ${history.length} 条最近提交历史吗？`,
    { modal: true },
    "清空"
  );
  if (confirmed !== "清空") {
    return;
  }
  await clearSubmissionHistory(context, state);
  if (state.resultPanel) {
    await showResultPanel(state, client);
  }
  treeProvider.refresh();
  vscode.window.showInformationMessage("最近提交历史已清空");
}

async function persistWorkbenchLayout(context, state) {
  const layout = {
    baseUrl: state.baseUrl,
    sourcePath: state.currentSourcePath || null,
    problemPanelVisible: Boolean(state.problemPanel),
    resultPanelVisible: Boolean(state.resultPanel)
  };
  state.workbenchLayout = layout;
  await context.globalState.update(WORKBENCH_LAYOUT_KEY, layout);
}

async function rememberSourceFile(context, state, sourcePath) {
  state.currentSourcePath = sourcePath;
  await persistWorkbenchLayout(context, state);
}

async function restoreWorkbenchLayout(context, client, state) {
  const layout = state.workbenchLayout;
  if (!layout) {
    return;
  }
  try {
    if (layout.sourcePath) {
      try {
        await fs.access(layout.sourcePath);
        const document = await vscode.workspace.openTextDocument(layout.sourcePath);
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: getWorkspaceViewColumn() });
        state.currentSourcePath = layout.sourcePath;
      } catch (error) {
        state.currentSourcePath = null;
      }
    }
    if (layout.resultPanelVisible && (state.lastLocalReport || state.lastSubmissionResult || (state.submissionHistory && state.submissionHistory.length))) {
      await showResultPanel(state, client);
    }
  } catch (error) {
    return;
  }
}

async function scanAllWorkspacesForProgress(context, client, state, contest, problems) {
  for (const problem of problems) {
    try {
      const workspace = await findExistingProblemWorkspace(problem, contest);
      if (workspace) {
        const progressRef = buildProblemProgressRef(client.baseUrl, problem, contest);
        await updateProblemProgress(context, state, progressRef, {
          workspaceCreated: true,
          language: workspace.metadata.language
        });
      }
    } catch (error) {
      // 单个题目的扫描错误不影响其他题目
    }
  }
}

async function loadContestWorkspace(context, client, state, treeProvider, contestId, contestPassword) {
  state.contestPassword = contestPassword || "";
  state.contestWorkspace = await client.getContestWorkspace(contestId, state.contestPassword);
  upsertContestWorkspaceSelection(state, state.contestWorkspace, client.baseUrl);
  await scanAllWorkspacesForProgress(
    context,
    client,
    state,
    state.contestWorkspace.contest,
    state.contestWorkspace.problems || []
  );
  state.activeProblem = null;
  treeProvider.refresh();
  const contest = state.contestWorkspace && state.contestWorkspace.contest ? state.contestWorkspace.contest : null;
  const status = normalizeContestStatus(contest && contest.status ? contest.status : "");
  if (status.key === "ended") {
    vscode.window.showWarningMessage(`实验「${contest.title}」已结束：不能远程提交，只能本地测评。`);
  } else if (status.key === "pending") {
    vscode.window.showWarningMessage(`实验「${contest.title}」当前为准备中：不能远程提交，只能本地测评。`);
  }
  return state.contestWorkspace;
}

async function findExistingProblemWorkspaceForOpenPanels(problem, contest) {
  const workspace = await findExistingProblemWorkspace(problem, contest);
  // 如果元数据存在但没有语言（批量初始化创建的目录），视为没有工作区
  if (workspace && workspace.metadata && !workspace.metadata.language) {
    return null;
  }
  // 检查源代码文件是否实际存在（防止文件被误删）
  if (workspace && workspace.sourceFilePath) {
    try {
      await fs.access(workspace.sourceFilePath);
    } catch {
      return null;
    }
  }
  return workspace;
}

async function getCurrentProblemWorkspaceState(state, problem, contest) {
  if (!problem) {
    return { hasWorkspace: false };
  }
  const existingWorkspace = await findExistingProblemWorkspaceForOpenPanels(problem, contest);
  if (!existingWorkspace) {
    return { hasWorkspace: false };
  }
  return {
    hasWorkspace: true,
    language: existingWorkspace.metadata.language,
    sourceFileName: getMetadataSourceFile(existingWorkspace.metadata, existingWorkspace.metadata.language),
    sourceFilePath: existingWorkspace.sourceFilePath,
    problemDir: existingWorkspace.problemDir,
    progressSummary: getProblemProgressSummary(
      getProblemProgress(
        state,
        existingWorkspace.metadata.baseUrl || state.baseUrl,
        problem,
        contest
      )
    )
  };
}

async function refreshProblemPanel(state, client, problem, contest) {
  if (!state.problemPanel || !problem) {
    return;
  }
  const workspaceState = await getCurrentProblemWorkspaceState(state, problem, contest);
  state.problemPanel.title = `${problem.display_id} ${problem.title}`;
  state.problemPanel.webview.html = renderProblemHtml(problem, client.baseUrl, workspaceState, state.user);
}

async function openWorkspaceSourceFile(sourceFilePath) {
  try {
    const document = await vscode.workspace.openTextDocument(sourceFilePath);
    // 使用Active视图列，避免创建新视图
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active });
  } catch (error) {
    vscode.window.showErrorMessage(`无法打开源代码文件：${sourceFilePath}。错误：${error.message}`);
  }
}

async function startWorkingOnProblem(context, client, state, outputChannel, problem, contest) {
  if (!problem) {
    vscode.window.showWarningMessage("请先打开题目，再开始作答");
    return null;
  }
  // 更新当前活动题目状态
  state.activeProblem = problem;
  state.activeContest = contest;
  
  let workspace = await findExistingProblemWorkspaceForOpenPanels(problem, contest);
  if (!workspace) {
    try {
      const createdWorkspace = await ensureLocalProblemWorkspace(client, state, problem, outputChannel);
      if (!createdWorkspace) {
        return null;
      }
      workspace = createdWorkspace;
      const downloadChoice = problem.can_download_test_case
        ? await vscode.window.showInformationMessage(
          "题目工作区已创建，是否顺便下载公开测试数据？",
          "下载",
          "暂不下载"
        )
        : null;
      if (downloadChoice === "下载") {
        try {
          await ensureTestCasesAvailable(client, state, outputChannel, workspace.problemDir, problem);
        } catch (error) {
          vscode.window.showWarningMessage(`下载测试数据失败：${error.message}，但本地工作区已创建成功`);
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`创建本地工作区失败：${error.message}`);
      return null;
    }
  }
  try {
    await updateProblemProgress(context, state, buildProblemProgressRef(client.baseUrl, problem, contest), {
      workspaceCreated: true,
      language: workspace.metadata.language,
      sourceFile: workspace.metadata.sourceFile
    });
  } catch (error) {
    // 进度更新失败不影响打开代码
  }
  await openWorkspaceSourceFile(workspace.sourceFilePath);
  await rememberSourceFile(context, state, workspace.sourceFilePath);
  try {
    await refreshProblemPanel(state, client, problem, contest);
  } catch (error) {
    // 刷新面板失败不影响打开代码
  }
  // 刷新树形菜单，确保状态更新
  if (state.treeDataProvider) {
    state.treeDataProvider.refresh();
  }
  return workspace;
}

async function openProblemDetail(client, state, problem, contest, contestPassword) {
  let detail = problem;
  try {
    detail = await client.getProblemWorkspace(problem.id, contest ? contest.id : undefined, contestPassword);
  } catch (error) {
    vscode.window.showWarningMessage(`获取题目详情失败：${error.message}，将使用本地缓存数据`);
    // 使用传入的 problem 对象作为备选
  }
  // 更新当前活动题目状态
  state.activeProblem = detail;
  state.activeContest = contest;
  
  let panel = state.problemPanel;
  if (!panel) {
    panel = vscode.window.createWebviewPanel("xmuojProblem", `${detail.display_id} ${detail.title}`, getProblemViewColumn(), { enableScripts: true });
    panel.onDidDispose(() => {
      if (state.problemPanel === panel) {
        state.problemPanel = null;
      }
      if (typeof state.persistenceHook === "function") {
        state.persistenceHook().catch(() => null);
      }
    });
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message.command === "startWork") {
          // 使用 state.activeProblem / state.activeContest 而不是闭包捕获的 detail/contest，
          // 因为面板复用时闭包中的 detail/contest 仍是上一次打开题目的值。
          await vscode.commands.executeCommand("xmuoj.startWorkingOnProblem", state.activeProblem, state.activeContest);
        } else if (message.command === "runTests") {
          await vscode.commands.executeCommand("xmuoj.runLocalTests");
        } else if (message.command === "downloadTests") {
          await vscode.commands.executeCommand("xmuoj.downloadTestCases");
        } else if (message.command === "submit") {
          await vscode.commands.executeCommand("xmuoj.submitCurrentFile");
        } else if (message.command === "showResults") {
          await vscode.commands.executeCommand("xmuoj.showResultPanel", {
            problem: state.activeProblem,
            contest: state.activeContest,
            baseUrl: client.baseUrl
          });
        } else if (message.command === "switchLanguage") {
          await vscode.commands.executeCommand("xmuoj.switchProblemLanguage");
        }
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    });
    state.problemPanel = panel;
  } else {
    panel.title = `${detail.display_id} ${detail.title}`;
    panel.reveal(getProblemViewColumn(), false);
  }
  try {
    await refreshProblemPanel(state, client, detail, contest);
  } catch (error) {
    // 刷新面板失败不影响页面显示
  }
  // 刷新树形菜单，确保状态更新
  if (state.treeDataProvider) {
    state.treeDataProvider.refresh();
  }
  if (typeof state.persistenceHook === "function") {
    await state.persistenceHook();
  }
  return detail;
}

async function showResultPanel(state, client, options = {}) {
  const preserveFocus = Boolean(options.preserveFocus);
  const problemRef = await resolveResultPanelProblemRef(client, state);
  const explicitSubmission = state.resultPanelFocus && state.resultPanelFocus.submission
    ? state.resultPanelFocus.submission
    : null;
  const focusMode = state.resultPanelFocus && state.resultPanelFocus.mode
    ? state.resultPanelFocus.mode
    : "current-problem";
  const localReport = pickLocalReportForProblem(state, problemRef);
  const submissionResult = focusMode === "local-report"
    ? null
    : pickSubmissionResultForProblem(state, problemRef, explicitSubmission);
  const submissionHistory = getSubmissionHistoryForProblem(state, problemRef);
  const historyNavigation = focusMode === "history-submission"
    ? getHistorySubmissionNavigation(state, problemRef, explicitSubmission)
    : null;
  let panel = state.resultPanel;
  if (!panel) {
    panel = vscode.window.createWebviewPanel("xmuojResultPanel", "XMUOJ 当前题结果报表", getResultViewColumn(), {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        if (message.command === "runTests") {
          await vscode.commands.executeCommand("xmuoj.runLocalTests");
        } else if (message.command === "submit") {
          await vscode.commands.executeCommand("xmuoj.submitCurrentFile");
        } else if (message.command === "showLatestResult") {
          await vscode.commands.executeCommand("xmuoj.showCurrentProblemLatestResult");
        } else if (message.command === "showNewerHistoryResult") {
          await vscode.commands.executeCommand("xmuoj.showAdjacentHistorySubmission", "newer");
        } else if (message.command === "showOlderHistoryResult") {
          await vscode.commands.executeCommand("xmuoj.showAdjacentHistorySubmission", "older");
        } else if (message.command === "pickHistoryResult") {
          await vscode.commands.executeCommand("xmuoj.pickProblemHistorySubmission");
        }
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    });
    panel.onDidDispose(() => {
      if (state.resultPanel === panel) {
        state.resultPanel = null;
      }
      if (typeof state.persistenceHook === "function") {
        state.persistenceHook().catch(() => null);
      }
    });
    state.resultPanel = panel;
  } else {
    panel.reveal(getResultViewColumn(), preserveFocus);
  }
  panel.title = problemRef && (problemRef.displayId || problemRef.title)
    ? `${focusMode === "history-submission" ? "历史提交" : "结果报表"} · ${(problemRef.displayId || "").trim()} ${(problemRef.title || "").trim()}`.trim()
    : "XMUOJ 当前题结果报表";
  panel.webview.html = renderResultPanelHtml({
    problemRef,
    localReport,
    submissionResult,
    focusMode,
    historyCount: submissionHistory.length,
    historyNavigation
  });
  if (typeof state.persistenceHook === "function") {
    await state.persistenceHook();
  }
  return panel;
}

async function showSubmissionResultPanel(context, state, client, result) {
  state.resultPanelFocus = {
    problemRef: buildResultProblemRefFromRecord(result),
    submission: result,
    mode: "latest-submission"
  };
  state.lastSubmissionResult = Object.assign({}, result, { baseUrl: client.baseUrl });
  await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, state.lastSubmissionResult);
  await showResultPanel(state, client, { preserveFocus: true });
}

async function showLocalReportPanel(context, state, client, report) {
  state.resultPanelFocus = {
    problemRef: buildResultProblemRefFromRecord(report),
    mode: "local-report"
  };
  state.lastLocalReport = Object.assign({}, report, { baseUrl: client.baseUrl });
  await context.globalState.update(LAST_LOCAL_REPORT_KEY, state.lastLocalReport);
  await showResultPanel(state, client, { preserveFocus: true });
}

async function chooseLanguage(problem, suggestedLanguage, options = {}) {
  const languages = problem.languages || [];
  if (!languages.length) {
    throw new Error("这道题当前没有可用语言");
  }
  if (!options.forcePick && suggestedLanguage && languages.includes(suggestedLanguage)) {
    return suggestedLanguage;
  }
  if (languages.length === 1) {
    return languages[0];
  }
  const pick = await vscode.window.showQuickPick(
    languages.map(language => ({ label: language })),
    { title: "选择本地题目工作区使用的语言", ignoreFocusOut: true }
  );
  return pick ? pick.label : null;
}

function pickProblemLanguage(problem, preferredLanguage) {
  const languages = problem.languages || [];
  if (!languages.length) {
    return null;
  }
  if (preferredLanguage && languages.includes(preferredLanguage)) {
    return preferredLanguage;
  }
  for (const language of LANGUAGE_PRIORITY) {
    if (languages.includes(language)) {
      return language;
    }
  }
  return languages[0];
}

async function switchLanguage(context, metadataContext, detail, nextLanguage, state, client, treeProvider) {
  const switched = await applyLanguageSwitch(
    metadataContext.problemDir,
    metadataContext.metadata,
    detail,
    nextLanguage
  );
  metadataContext.metadata = switched.metadata;
  const document = await vscode.workspace.openTextDocument(switched.sourcePath);
  // 使用Active视图列，避免创建新视图
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active });
  await rememberSourceFile(context, state, switched.sourcePath);
  state.currentTreeFilePath = switched.sourcePath;
  if (metadataContext.metadata && metadataContext.metadata.problemId) {
    await updateProblemProgress(
      context,
      state,
      {
        key: [
          switched.metadata.baseUrl || client.baseUrl,
          switched.metadata.contestId || "problemset",
          switched.metadata.problemId
        ].join("::"),
        baseUrl: switched.metadata.baseUrl || client.baseUrl,
        problemId: switched.metadata.problemId,
        displayId: switched.metadata.displayId || "",
        title: switched.metadata.title || "",
        contestId: switched.metadata.contestId || null,
        contestTitle: switched.metadata.contestTitle || null
      },
      {
        workspaceCreated: true,
        language: switched.metadata.language,
        sourceFile: switched.metadata.sourceFile
      }
    );
  }
  if (treeProvider) {
    treeProvider.refresh();
  }
  await refreshProblemPanel(state, client);
  vscode.window.showInformationMessage(`题目语言已切换为 ${nextLanguage}`);
}

function resolveProblemAndContestFromMenuItem(menuItem, state) {
  let problem = null;
  let contest = null;
  if (menuItem) {
    if (menuItem.problem) {
      problem = menuItem.problem;
    } else if (menuItem.id && menuItem.display_id) {
      problem = menuItem;
    }
    if (menuItem.contest) {
      contest = menuItem.contest;
    }
  }
  if (!problem && state.activeProblem) {
    problem = state.activeProblem;
    contest = state.activeContest;
  }
  return { problem, contest };
}

async function resolveLanguageSwitchRequest(client, state, menuItem) {
  try {
    const { problem, contest } = resolveProblemAndContestFromMenuItem(menuItem, state);
    if (!problem) {
      vscode.window.showWarningMessage("无法切换代码语言：未找到题目信息");
      return { problem: null, contest: null, sourceContext: null, detail: null };
    }
    
    const sourceContext = await resolveSourceContext(client, state, problem, contest);
    if (!sourceContext || !sourceContext.metadataContext || !sourceContext.metadataContext.metadata || !sourceContext.metadataContext.problemDir) {
      vscode.window.showWarningMessage("无法切换代码语言：请先为这道题创建本地工作区，再切换语言。可以先点“创建代码”。");
      return { problem, contest, sourceContext: null, detail: null };
    }

    let detail = null;
    try {
      const binding = await ensureValidProblemBinding(client, state, sourceContext.metadataContext);
      if (binding.ok && binding.detail) {
        detail = binding.detail;
      } else {
        // 尝试从问题对象获取问题详情
        if (problem && problem.id) {
          const targetContest = contest || (state.contestWorkspace ? state.contestWorkspace.contest : null);
          detail = await client.getProblemWorkspace(problem.id, targetContest ? targetContest.id : undefined);
        }
      }
    } catch (error) {
      // 如果绑定失败，尝试直接从问题对象获取详情
      if (problem && problem.id) {
        try {
          const targetContest = contest || (state.contestWorkspace ? state.contestWorkspace.contest : null);
          detail = await client.getProblemWorkspace(problem.id, targetContest ? targetContest.id : undefined);
        } catch (error2) {
          // 网络请求失败，使用本地数据
          console.log("获取问题详情失败，使用本地数据进行语言切换:", error2.message);
        }
      }
    }

    return { problem, contest, sourceContext, detail };
  } catch (error) {
    vscode.window.showErrorMessage(`无法切换代码语言：${error.message || error}`);
    return { problem: null, contest: null, sourceContext: null, detail: null };
  }
}



async function initContestProblemFolders(context, client, state, outputChannel, workspaceEntry) {
  const targetWorkspace = workspaceEntry && workspaceEntry.contest
    ? { contest: workspaceEntry.contest, problems: workspaceEntry.problems || [] }
    : state.contestWorkspace;
  const targetContestPassword = workspaceEntry && Object.prototype.hasOwnProperty.call(workspaceEntry, "contestPassword")
    ? (workspaceEntry.contestPassword || "")
    : (state.contestPassword || "");
  if (!targetWorkspace || !targetWorkspace.contest) {
    vscode.window.showWarningMessage("请先打开一个比赛，再批量创建题目目录");
    return;
  }
  const rootPath = await chooseWorkspaceRoot();
  if (!rootPath) {
    return;
  }

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine(`目标实验：${targetWorkspace.contest.title} (#${targetWorkspace.contest.id})`);
  outputChannel.appendLine(`工作区根目录：${rootPath}`);
  const created = [];
  for (const problem of targetWorkspace.problems || []) {
    try {
      const detail = await client.getProblemWorkspace(problem.id, targetWorkspace.contest.id, targetContestPassword || undefined);
      const problemDir = buildProblemDirectory(rootPath, detail, targetWorkspace.contest);
      const samplesDir = path.join(problemDir, "samples");
      await fs.mkdir(samplesDir, { recursive: true });

      const markdownPath = path.join(problemDir, "problem.md");
      await fs.writeFile(markdownPath, buildProblemMarkdown(detail, targetWorkspace.contest), "utf8");

      for (let index = 0; index < (detail.samples || []).length; index += 1) {
        const sample = detail.samples[index];
        const sampleNumber = index + 1;
        await fs.writeFile(path.join(samplesDir, `${sampleNumber}.in`), sample.input || "", "utf8");
        await fs.writeFile(path.join(samplesDir, `${sampleNumber}.out`), sample.output || "", "utf8");
      }

      const metadata = {
        version: 1,
        baseUrl: client.baseUrl,
        problemId: detail.id,
        contestId: targetWorkspace.contest.id,
        contestTitle: targetWorkspace.contest.title,
        displayId: detail.display_id,
        title: detail.title,
        language: null,
        sourceFile: null,
        sourceFiles: {},
        createdAt: new Date().toISOString()
      };
      const metadataPath = path.join(problemDir, METADATA_FILE_NAME);
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

      created.push(problemDir);
      outputChannel.appendLine(`已创建 ${detail.display_id} → ${problemDir}`);
    } catch (error) {
      outputChannel.appendLine(`${problem.display_id} 创建失败：${error.message}`);
    }
  }
  if (created.length) {
    vscode.window.showInformationMessage(`已为实验「${targetWorkspace.contest.title}」批量创建 ${created.length} 个题目的本地目录`);
  } else {
    vscode.window.showWarningMessage("没有成功创建任何题目目录");
  }
}
async function materializeContestWorkspace(context, client, state, outputChannel) {
  if (!state.contestWorkspace) {
    vscode.window.showWarningMessage("请先打开一个比赛，再批量生成本地工作区");
    return;
  }
  const rootPath = await chooseWorkspaceRoot();
  if (!rootPath) {
    return;
  }
  const preferredLanguagePick = await vscode.window.showQuickPick(
    LANGUAGE_PRIORITY.map(language => ({ label: language })),
    {
      title: "选择批量生成时优先使用的语言",
      ignoreFocusOut: true
    }
  );
  if (!preferredLanguagePick) {
    return;
  }
  const downloadChoice = await vscode.window.showQuickPick([
    { label: "只创建工作区", download: false },
    { label: "创建工作区并下载公开测试数据", download: true }
  ], {
    title: "批量生成选项",
    ignoreFocusOut: true
  });
  if (!downloadChoice) {
    return;
  }

  outputChannel.clear();
  outputChannel.show(true);
  const created = [];
  for (const problem of state.contestWorkspace.problems || []) {
    const detail = await client.getProblemWorkspace(problem.id, state.contestWorkspace.contest.id, state.contestPassword || undefined);
    const language = pickProblemLanguage(detail, preferredLanguagePick.label);
    if (!language) {
      outputChannel.appendLine(`跳过 ${problem.display_id}：没有可用语言`);
      continue;
    }
    const workspace = await ensureProblemWorkspace({
      rootPath,
      problem: detail,
      contest: state.contestWorkspace.contest,
      language,
      baseUrl: client.baseUrl
    });
    await createWorkspaceTasks(rootPath, workspace.problemDir, workspace.metadata);
    await updateProblemProgress(context, state, buildProblemProgressRef(client.baseUrl, detail, state.contestWorkspace.contest), {
      workspaceCreated: true,
      language,
      sourceFile: workspace.metadata.sourceFile
    });
    if (downloadChoice.download && detail.can_download_test_case) {
      try {
        await ensureTestCasesAvailable(client, state, outputChannel, workspace.problemDir, detail);
      } catch (error) {
        outputChannel.appendLine(`${detail.display_id} 下载测试数据失败：${error.message}`);
      }
    }
    created.push(workspace);
    outputChannel.appendLine(`已生成 ${detail.display_id}，目录：${workspace.problemDir}`);
  }
  if (!created.length) {
    vscode.window.showWarningMessage("没有生成任何本地比赛工作区");
    return;
  }
  vscode.window.showInformationMessage(`已在 ${rootPath} 下生成 ${created.length} 个比赛题目工作区`);
}

async function ensureLocalProblemWorkspace(client, state, problem, outputChannel, options = {}) {
  const rootPath = await chooseWorkspaceRoot();
  if (!rootPath) {
    vscode.window.showErrorMessage("未选择本地工作区根目录，无法创建题目工作区。");
    return null;
  }
  const suggestedLanguage = options.suggestedLanguage || (vscode.window.activeTextEditor ? inferLanguage(vscode.window.activeTextEditor.document) : null);
  const language = await chooseLanguage(problem, suggestedLanguage);
  if (!language) {
    vscode.window.showErrorMessage("未选择编程语言，无法创建题目工作区。");
    return null;
  }
  const contextContest = state.contestWorkspace ? state.contestWorkspace.contest : null;
  const workspace = await ensureProblemWorkspace({
    rootPath,
    problem,
    contest: contextContest,
    language,
    baseUrl: client.baseUrl
  });
  outputChannel.appendLine(`题目工作区已生成：${workspace.problemDir}`);
  return workspace;
}

async function ensureTestCasesAvailable(client, state, outputChannel, explicitProblemDir, explicitProblem) {
  const editor = vscode.window.activeTextEditor;
  const metadataContext = editor ? await getEditorProblemContext(client, editor.document) : { metadata: null, problemDir: explicitProblemDir || null };
  let problem = explicitProblem || state.activeProblem;
  let problemDir = explicitProblemDir || metadataContext.problemDir;

  if (!problem && metadataContext.metadata) {
    problem = {
      id: metadataContext.metadata.problemId,
      display_id: metadataContext.metadata.displayId,
      title: metadataContext.metadata.title,
      can_download_test_case: true
    };
  }

  if (!problem) {
    vscode.window.showWarningMessage("请先打开题目，或者先进入一个本地 XMUOJ 题目源文件后再下载测试数据");
    return null;
  }

  if (!problemDir && state.activeProblem) {
    const workspace = await ensureLocalProblemWorkspace(client, state, state.activeProblem, outputChannel, { suggestedLanguage: metadataContext.metadata ? metadataContext.metadata.language : null });
    if (!workspace) {
      return null;
    }
    problemDir = workspace.problemDir;
  }

  let contestPassword = "";
  const contestId = (metadataContext.metadata && metadataContext.metadata.contestId)
    || (state.contestWorkspace && state.contestWorkspace.contest && state.contestWorkspace.contest.id)
    || null;
  if (contestId) {
    contestPassword = resolveContestPassword(state, contestId);
    if (!contestPassword) {
      contestPassword = await vscode.window.showInputBox({
        prompt: "如果比赛下载测试数据需要密码，请输入比赛密码",
        password: true,
        ignoreFocusOut: true
      }) || "";
    }
  }

  const archive = await client.downloadTestCases(problem.id || metadataContext.metadata.problemId, contestPassword || undefined);
  if (contestId && contestPassword) {
    cacheContestPassword(state, contestId, contestPassword);
  }
  const saved = await saveTestCaseArchive(problemDir, archive.buffer, archive.fileName || `${problem.display_id || metadataContext.metadata.displayId}-testcases.zip`);
  outputChannel.appendLine(`测试数据压缩包已保存到：${saved.archivePath}`);
  outputChannel.appendLine(`测试数据已解压到：${saved.extractedDir}`);
  return saved;
}

function activate(context) {
  const client = new XmuojClient(context);
  const outputChannel = vscode.window.createOutputChannel("XMUOJ");
  const userStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const contestStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  userStatusBar.command = "xmuoj.login";
  contestStatusBar.command = "xmuoj.browseContests";
  context.globalState.update(RECENT_CONTESTS_KEY, []).catch(() => null);
  context.globalState.update(RECENT_PROBLEMS_KEY, []).catch(() => null);

  const state = {
    contestWorkspace: null,
    openContestWorkspaces: [],
    problemsetSelections: context.globalState.get(PROBLEMSET_SELECTIONS_KEY, []),
    contestPassword: "",
    user: null,
    bootstrapReady: false,
    lastSubmissionResult: context.globalState.get(LAST_SUBMISSION_RESULT_KEY, null),
    lastLocalReport: context.globalState.get(LAST_LOCAL_REPORT_KEY, null),
    submissionHistory: context.globalState.get(SUBMISSION_HISTORY_KEY, []),
    recentSubmissionScope: context.globalState.get(RECENT_SUBMISSION_SCOPE_KEY, "all"),
    recentSubmissionDensity: context.globalState.get(RECENT_SUBMISSION_DENSITY_KEY, "all"),
    recentSubmissionResultFilter: context.globalState.get(RECENT_SUBMISSION_RESULT_FILTER_KEY, "all"),
    recentSubmissionLanguageFilter: context.globalState.get(RECENT_SUBMISSION_LANGUAGE_FILTER_KEY, "all"),
    problemProgress: context.globalState.get(PROBLEM_PROGRESS_KEY, {}),
    resultPanel: null,
    baseUrl: client.baseUrl,
    currentSourcePath: null,
    currentTreeFilePath: null,
    workbenchLayout: context.globalState.get(WORKBENCH_LAYOUT_KEY, null),
    problemsetWorkbench: null,
    problemsetPanel: null,
    outputChannel
  };
  state.resultPanelFocus = null;
  state.persistenceHook = () => persistWorkbenchLayout(context, state);
  state.userStatusBar = userStatusBar;
  state.contestStatusBar = contestStatusBar;

  const treeProvider = new ProblemTreeDataProvider(state);
  state.treeDataProvider = treeProvider;
  const codeLensProvider = new XmuojCodeLensProvider();
  vscode.window.registerTreeDataProvider("xmuojExplorer", treeProvider);
  context.subscriptions.push(vscode.languages.registerCodeLensProvider([{ scheme: "file" }], codeLensProvider));

  async function refreshCurrentTreeFile(editor) {
    if (!editor) {
      if (state.currentTreeFilePath) {
        state.currentTreeFilePath = null;
        treeProvider.refresh();
      }
      return;
    }
    try {
      const metadataEntry = await findProblemMetadata(editor.document.fileName);
      const nextPath = metadataEntry && metadataEntry.metadata ? editor.document.fileName : null;
      if (nextPath !== state.currentTreeFilePath) {
        state.currentTreeFilePath = nextPath;
        treeProvider.refresh();
      }
      if (metadataEntry && metadataEntry.metadata) {
        await rememberSourceFile(context, state, editor.document.fileName);
      }
    } catch (error) {
      if (state.currentTreeFilePath) {
        state.currentTreeFilePath = null;
        treeProvider.refresh();
      }
    }
  }

  updateStatusBars(state, userStatusBar, contestStatusBar, client);
  userStatusBar.show();
  contestStatusBar.show();

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    await refreshCurrentTreeFile(editor);
  }));

  refreshCurrentTreeFile(vscode.window.activeTextEditor).catch(() => null);

  client.getBootstrap().then(async (bootstrap) => {
    state.user = bootstrap.user;
    state.bootstrapReady = true;
    // Bootstrap 成功但 user 为空 → 清理残留认证态，避免后续请求携带失效凭证
    if (!state.user) {
      const staleToken = await client.getToken().catch(() => null);
      if (staleToken) {
        await client.setToken("").catch(() => null);
      }
      await client.setSessionCookies("").catch(() => null);
    }
    codeLensProvider.setUser(state.user);
    updateStatusBars(state, userStatusBar, contestStatusBar, client);
    treeProvider.refresh();
    refreshProblemPanel(state, client).catch(() => null);
    restoreWorkbenchLayout(context, client, state).then(() => treeProvider.refresh()).catch(() => null);
  }).catch(async () => {
    // Bootstrap 失败（网络错误等）→ 标记 ready 以便后续 pre-flight 检查正常工作
    state.bootstrapReady = true;
    state.user = null;
    const staleToken = await client.getToken().catch(() => null);
    if (staleToken) {
      await client.setToken("").catch(() => null);
    }
    await client.setSessionCookies("").catch(() => null);
    codeLensProvider.setUser(null);
    updateStatusBars(state, userStatusBar, contestStatusBar, client);
    treeProvider.refresh();
  });



  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.login", async () => {
    const username = await vscode.window.showInputBox({ prompt: "请输入 XMUOJ 用户名", ignoreFocusOut: true });
    if (!username) {
      return;
    }
    const password = await vscode.window.showInputBox({ prompt: "请输入 XMUOJ 密码", password: true, ignoreFocusOut: true });
    if (!password) {
      return;
    }
    try {
      const result = await client.login(username, password);
      state.user = result.user;
      codeLensProvider.setUser(state.user);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
      await refreshProblemPanel(state, client);
      vscode.window.showInformationMessage(`已登录：${result.user.username}`);
    } catch (error) {
      if (String(error.message) === "tfa_required") {
        const tfaCode = await vscode.window.showInputBox({ prompt: "请输入两步验证码", ignoreFocusOut: true });
        if (!tfaCode) {
          return;
        }
        const result = await client.login(username, password, tfaCode);
        state.user = result.user;
        codeLensProvider.setUser(state.user);
        updateStatusBars(state, userStatusBar, contestStatusBar, client);
        treeProvider.refresh();
        await refreshProblemPanel(state, client);
        vscode.window.showInformationMessage(`已登录：${result.user.username}`);
        return;
      }
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.logout", async () => {
    await client.logout();
    state.user = null;
    codeLensProvider.setUser(state.user);
    updateStatusBars(state, userStatusBar, contestStatusBar, client);
    treeProvider.refresh();
    await refreshProblemPanel(state, client);
    vscode.window.showInformationMessage("已清除 XMUOJ 登录令牌");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.browseContests", async () => {
    const keyword = await vscode.window.showInputBox({
      prompt: "按比赛标题搜索，留空则显示最新比赛",
      ignoreFocusOut: true
    });
    try {
      const contestData = await client.getContests({ keyword: keyword || undefined });
      if (!contestData.results.length) {
        vscode.window.showInformationMessage("没有找到符合条件的比赛");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        contestData.results.map(contest => ({
          label: contest.title,
          description: `${contest.rule_type} · ${getContestStatusLabel(contest)}`,
          detail: contest.require_password ? `#${contest.id} · 需要密码` : `#${contest.id}`,
          contest
        })),
        { title: "选择要加载的比赛", ignoreFocusOut: true }
      );
      if (!pick) {
        return;
      }
      const contestPassword = pick.contest.require_password
        ? await vscode.window.showInputBox({ prompt: "请输入比赛密码", password: true, ignoreFocusOut: true })
        : "";
      const workspace = await loadContestWorkspace(context, client, state, treeProvider, pick.contest.id, contestPassword || "");
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      vscode.window.showInformationMessage(`已加载比赛：${workspace.contest.title}`);
    } catch (error) {
      await handleXmuojError(error, state, client, treeProvider);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.browseProblemset", async () => {
    try {
      clearContestContext(state);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
      await openProblemsetWorkbench(context, client, state, treeProvider);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openContest", async () => {
    const input = await vscode.window.showInputBox({
      prompt: "请输入比赛 ID 或完整比赛链接",
      ignoreFocusOut: true
    });
    if (!input) {
      return;
    }
    const contestId = extractContestId(input);
    const contestPassword = await vscode.window.showInputBox({
      prompt: "如果比赛需要密码，请输入比赛密码",
      password: true,
      ignoreFocusOut: true
    });
    // 等待 bootstrap 完成（最多 5 秒）
    if (!state.bootstrapReady) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "正在检查登录状态…" }, async () => {
        const deadline = Date.now() + 5000;
        while (!state.bootstrapReady && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      });
    }
    if (!state.user) {
      await handleXmuojError(new Error("Please login first."), state, client, treeProvider);
      return;
    }
    try {
      const workspace = await loadContestWorkspace(context, client, state, treeProvider, contestId, contestPassword || "");
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      vscode.window.showInformationMessage(`已加载比赛：${workspace.contest.title}`);
    } catch (error) {
      await handleXmuojError(error, state, client, treeProvider);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.refreshContest", async (workspaceEntry) => {
    if (workspaceEntry && workspaceEntry.contest) {
      syncActiveContestByEntry(state, workspaceEntry);
    }
    const targetContest = workspaceEntry && workspaceEntry.contest
      ? workspaceEntry.contest
      : (state.contestWorkspace ? state.contestWorkspace.contest : null);
    const targetPassword = workspaceEntry && Object.prototype.hasOwnProperty.call(workspaceEntry, "contestPassword")
      ? (workspaceEntry.contestPassword || "")
      : state.contestPassword;
    if (!targetContest) {
      vscode.window.showWarningMessage("当前还没有加载实验");
      return;
    }
    try {
      await loadContestWorkspace(context, client, state, treeProvider, targetContest.id, targetPassword);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      vscode.window.showInformationMessage(`实验刷新成功：${targetContest.title}`);
    } catch (error) {
      await handleXmuojError(error, state, client, treeProvider);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.revealContestWorkspace", async (workspaceEntry) => {
    if (workspaceEntry && workspaceEntry.contest) {
      syncActiveContestByEntry(state, workspaceEntry);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
    }
    const contest = (workspaceEntry && workspaceEntry.contest)
      || (state.contestWorkspace && state.contestWorkspace.contest);
    if (!contest || !contest.id) {
      vscode.window.showWarningMessage("当前没有可用的实验信息");
      return;
    }
    const root = String(vscode.workspace.getConfiguration("xmuoj").get("localWorkspaceRoot", "") || "").trim();
    if (!root) {
      vscode.window.showWarningMessage("请先在「设置」里选择本地工作区根目录。");
      return;
    }
    const contestDir = path.join(root, `contest-${contest.id}`);
    try {
      await fs.access(contestDir);
    } catch (_error) {
      vscode.window.showWarningMessage(`在本地工作区中尚未找到「contest-${contest.id}」目录，请先生成本地题目。`);
      return;
    }
    const uri = vscode.Uri.file(contestDir);
    await vscode.commands.executeCommand("revealFileInOS", uri);
    vscode.window.showInformationMessage(`实验「${contest.title || contest.id}」目录：${contestDir}`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.revealProblemsetWorkspace", async () => {
    const root = String(vscode.workspace.getConfiguration("xmuoj").get("localWorkspaceRoot", "") || "").trim();
    if (!root) {
      vscode.window.showWarningMessage("请先在「设置」里选择本地工作区根目录。");
      return;
    }
    const problemsetDir = path.join(root, PROBLEMSET_DIR_NAME);
    await fs.mkdir(problemsetDir, { recursive: true });
    const uri = vscode.Uri.file(problemsetDir);
    await vscode.commands.executeCommand("revealFileInOS", uri);
    vscode.window.showInformationMessage(`题库目录：${problemsetDir}`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openProblem", async (problem) => {
    if (!problem) {
      vscode.window.showWarningMessage("没有选中的题目");
      return;
    }
    try {
      const detail = await openProblemDetail(
        client,
        state,
        problem,
        state.contestWorkspace ? state.contestWorkspace.contest : null,
        state.contestPassword
      );
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openProblemsetProblem", async (item) => {
    if (!item) {
      return;
    }
    try {
      clearContestContext(state);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      const detail = await openProblemDetail(client, state, { id: item.id, display_id: item.display_id, title: item.title }, null, "");
      upsertProblemsetSelection(state, detail, client.baseUrl);
      await persistProblemsetSelections(context, state);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.manageProblemsetSelections", async () => {
    const current = state.problemsetSelections || [];
    if (!current.length) {
      vscode.window.showInformationMessage("公共题库里还没有已选题目");
      return;
    }
    const picked = await vscode.window.showQuickPick([
      { label: "清空全部", value: "clear" },
      ...current.map((item) => ({ label: `${item.display_id} ${item.title}`, description: item.baseUrl, value: item }))
    ], {
      title: "管理公共题库已选题目",
      placeHolder: "选择要移除的一道题，或清空全部"
    });
    if (!picked) {
      return;
    }
    if (picked.value === "clear") {
      const confirmed = await vscode.window.showWarningMessage("确定要删除公共题库中的全部已选题目吗？", { modal: true }, "删除全部");
      if (confirmed !== "删除全部") {
        return;
      }
      clearProblemsetSelections(state);
      await persistProblemsetSelections(context, state);
    } else {
      const confirmed = await vscode.window.showWarningMessage(`确定要删除题目“${picked.value.display_id} ${picked.value.title}”吗？`, { modal: true }, "删除题目");
      if (confirmed !== "删除题目") {
        return;
      }
      state.problemsetSelections = current.filter((item) => !(String(item.id) === String(picked.value.id) && normalizeBaseUrlForKey(item.baseUrl) === normalizeBaseUrlForKey(picked.value.baseUrl)));
      await persistProblemsetSelections(context, state);
    }
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.removeProblemsetSelection", async (item) => {
    if (!item) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(`确定要删除题目“${item.display_id} ${item.title}”吗？`, { modal: true }, "删除题目");
    if (confirmed !== "删除题目") {
      return;
    }
    removeProblemsetSelection(state, item);
    await persistProblemsetSelections(context, state);
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openContestWorkspaceByItem", async (item) => {
    if (!item) {
      return;
    }
    try {
      state.contestWorkspace = {
        contest: item.contest,
        problems: item.problems || []
      };
      state.contestPassword = item.contestPassword || "";
      state.activeContest = item.contest;
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openContestWorkspaceProblem", async (payload) => {
    if (!payload || !payload.problem || !payload.contest) {
      return;
    }
    try {
      state.contestWorkspace = {
        contest: payload.contest,
        problems: payload.problems || []
      };
      state.contestPassword = payload.contestPassword || "";
      const detail = await openProblemDetail(client, state, payload.problem, payload.contest, state.contestPassword);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
    } catch (error) {
      await handleXmuojError(error, state, client, treeProvider);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.manageContestWorkspaceSelections", async () => {
    const current = state.openContestWorkspaces || [];
    if (!current.length) {
      vscode.window.showInformationMessage("比赛列表里还没有已打开比赛");
      return;
    }
    const picked = await vscode.window.showQuickPick([
      { label: "清空全部", value: "clear" },
      ...current.map((item) => ({ label: item.contest.title, description: `#${item.contest.id}`, value: item }))
    ], {
      title: "管理比赛列表",
      placeHolder: "选择要移除的一场比赛，或清空全部"
    });
    if (!picked) {
      return;
    }
    if (picked.value === "clear") {
      const confirmClear = await vscode.window.showWarningMessage(
        "确定要删除比赛列表中的全部比赛吗？",
        { modal: true },
        "删除全部"
      );
      if (confirmClear !== "删除全部") {
        return;
      }
      state.openContestWorkspaces = [];
    } else {
      const confirmRemove = await vscode.window.showWarningMessage(
        `确定要删除比赛“${picked.value.contest.title}”吗？`,
        { modal: true },
        "删除比赛"
      );
      if (confirmRemove !== "删除比赛") {
        return;
      }
      state.openContestWorkspaces = current.filter((item) => item.key !== picked.value.key);
    }
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.removeContestWorkspaceSelection", async (item) => {
    if (!item) {
      return;
    }
    const confirmRemove = await vscode.window.showWarningMessage(
      `确定要删除比赛“${item.contest && item.contest.title ? item.contest.title : "未命名比赛"}”吗？`,
      { modal: true },
      "删除比赛"
    );
    if (confirmRemove !== "删除比赛") {
      return;
    }
    removeContestWorkspaceSelection(state, item);
    updateStatusBars(state, userStatusBar, contestStatusBar, client);
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.startWorkingOnProblem", async (problem, contest) => {
    try {
      await startWorkingOnProblem(context, client, state, outputChannel, problem, contest);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.createProblemWorkspace", async () => {
    try {
      const selectedFolder = await chooseWorkspaceRoot({ forcePick: true });
      if (selectedFolder) {
        vscode.window.showInformationMessage(`已设置本地工作区目录：${selectedFolder}`);
      }
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.rebindCurrentProblem", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("请先打开本地 XMUOJ 题目源文件，再重新绑定当前题目");
      return;
    }
    try {
      const metadataContext = await getEditorProblemContext(client, editor.document);
      if (!metadataContext.metadata || !metadataContext.problemDir) {
        vscode.window.showWarningMessage("当前文件不在 XMUOJ 题目工作区内");
        return;
      }
      const detail = await rebindProblemFromMetadata(client, state, metadataContext);
      const contest = metadataContext.metadata.contestId
        ? { id: metadataContext.metadata.contestId, title: metadataContext.metadata.contestTitle || "" }
        : null;
      await refreshProblemPanel(state, client, detail, contest);
      treeProvider.refresh();
      vscode.window.showInformationMessage(`已重新绑定题目：${detail.display_id} ${detail.title}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.switchProblemLanguage", async (menuItem) => {
    try {
      await switchProblemLanguageLocally(context, state, client, treeProvider, menuItem);
    } catch (error) {
      vscode.window.showErrorMessage(`切换代码语言失败：${error.message || error}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.generateAiSolution", async () => {
    vscode.window.showInformationMessage("AI 解题功能尚未开放。");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.generateAiCode", async () => {
    vscode.window.showInformationMessage("AI 代码功能尚未开放。");
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.downloadTestCases", async () => {
    // 等待 bootstrap 完成（最多 5 秒），避免竞态导致误判为未登录
    if (!state.bootstrapReady) {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "正在检查登录状态…" }, async () => {
        const deadline = Date.now() + 5000;
        while (!state.bootstrapReady && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      });
    }
    if (!state.user) {
      await handleXmuojError(new Error("Please login first."), state, client, treeProvider);
      return;
    }
    try {
      const saved = await ensureTestCasesAvailable(client, state, outputChannel);
      if (!saved) {
        return;
      }
      vscode.window.showInformationMessage(`测试数据已下载到 ${saved.extractedDir}`);
    } catch (error) {
      await handleXmuojError(error, state, client, treeProvider);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.generateLocalTasks", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("请先打开本地 XMUOJ 题目源文件，再生成任务");
      return;
    }
    try {
      const metadataContext = await getEditorProblemContext(client, editor.document);
      if (!metadataContext.metadata || !metadataContext.problemDir) {
        vscode.window.showWarningMessage("当前文件不在 XMUOJ 题目工作区内");
        return;
      }
      const folders = await getLocalWorkspaceFolderHandles();
      let workspaceRoot = folders[0] ? folders[0].uri.fsPath : null;
      if (!workspaceRoot) {
        workspaceRoot = await chooseWorkspaceRoot();
      }
      if (!workspaceRoot) {
        return;
      }
      const tasksPath = await createWorkspaceTasks(workspaceRoot, metadataContext.problemDir, metadataContext.metadata);
      vscode.window.showInformationMessage(`本地任务已生成到 ${tasksPath}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.runLocalTests", async () => {
    try {
      // 先保存所有脏文件
      await vscode.workspace.saveAll(false);
      
      const sourceContext = await resolveSourceContext(client, state);
      if (!sourceContext) {
        vscode.window.showWarningMessage("请先打开本地源文件，或者先为当前题目创建工作区再运行测试");
        return;
      }
      const { document, metadataContext, sourcePath } = sourceContext;
      
      // 确保当前文档已保存
      if (document.isDirty) {
        await document.save();
      }
      
      const language = inferLanguage(document) || metadataContext.metadata.language;
      if (!language) {
        vscode.window.showErrorMessage("无法判断当前文件对应的语言");
        return;
      }
      const extractedCaseDir = path.join(metadataContext.problemDir, "testcases", "extracted");
      let caseDir = extractedCaseDir;
      try {
        await fs.access(extractedCaseDir);
      } catch (error) {
        caseDir = path.join(metadataContext.problemDir, "samples");
      }
      outputChannel.clear();
      outputChannel.show(true);
      const summary = await runLocalCases({
        sourcePath,
        language,
        caseDir,
        outputChannel
      });
      const report = Object.assign({}, summary, {
        displayId: metadataContext.metadata.displayId,
        title: metadataContext.metadata.title,
        language,
        baseUrl: metadataContext.metadata.baseUrl || client.baseUrl,
        problemId: metadataContext.metadata.problemId,
        contestId: metadataContext.metadata.contestId || null,
        problemDir: metadataContext.problemDir,
        caseDir
      });
      outputChannel.appendLine(`汇总：通过 ${summary.passed}，失败 ${summary.failed}`);
      const message = `本地测试结束：${summary.passed}/${summary.total} 通过`;
      await updateProblemProgress(
        context,
        state,
        buildProblemProgressRef(
          metadataContext.metadata.baseUrl || client.baseUrl,
          {
            id: metadataContext.metadata.problemId,
            display_id: metadataContext.metadata.displayId,
            title: metadataContext.metadata.title
          },
          metadataContext.metadata.contestId ? { id: metadataContext.metadata.contestId, title: metadataContext.metadata.contestTitle } : null
        ),
        {
          workspaceCreated: true,
          language,
          sourceFile: path.basename(sourcePath),
          localPassed: summary.failed === 0,
          lastLocalPassed: summary.passed,
          lastLocalTotal: summary.total
        }
      );
      await showLocalReportPanel(context, state, client, report);
      treeProvider.refresh();
      await refreshProblemPanel(state, client);
      if (summary.failed === 0) {
        vscode.window.showInformationMessage(message);
      } else {
        vscode.window.showWarningMessage(message);
      }
    } catch (error) {
      outputChannel.appendLine(error.stack || error.message);
      outputChannel.show(true);
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.submitCurrentFile", async () => {
    try {
      // 先保存所有脏文件
      await vscode.workspace.saveAll(false);
      
      const sourceContext = await resolveSourceContext(client, state);
      if (!sourceContext) {
        vscode.window.showWarningMessage("请先打开要提交的源文件，或者先为当前题目创建工作区");
        return;
      }
      const { document, metadataContext, sourcePath, usedActiveEditor } = sourceContext;
      
      // 确保当前文档已保存
      if (document.isDirty) {
        await document.save();
      }
      
      const binding = metadataContext.metadata ? await ensureValidProblemBinding(client, state, metadataContext) : { ok: true, detail: state.activeProblem };
      if (!binding.ok) {
        return;
      }
      const problem = binding.detail || state.activeProblem;
      const problemId = problem ? problem.id : metadataContext.metadata ? metadataContext.metadata.problemId : null;
      if (!problemId) {
        vscode.window.showWarningMessage("提交前请先打开题目，或者在 XMUOJ 题目工作区中操作");
        return;
      }
      const language = inferLanguage(document) || (metadataContext.metadata ? metadataContext.metadata.language : null);
      if (!language) {
        vscode.window.showErrorMessage("无法根据当前文件后缀判断提交语言");
        return;
      }
      // 检查题目是否支持当前语言
      const supportedLanguages = Array.isArray(problem && problem.languages) ? problem.languages : [];
      if (supportedLanguages.length > 0) {
        const langSupported = supportedLanguages.includes(language);
        if (!langSupported) {
          const supported = supportedLanguages.join(" / ");
          vscode.window.showErrorMessage(
            `当前文件使用的语言是 ${language}，但该题目只支持：${supported}。请切换到支持的语言后再提交。`
          );
          return;
        }
        // 语言受支持，当题目限制了语言范围时，提示用户将以哪种语言提交
        if (supportedLanguages.length > 1) {
          vscode.window.showInformationMessage(
            `将以 ${language} 提交（该题支持：${supportedLanguages.join(" / ")}）`
          );
        }
      }
      try {
        let contestPassword;
        const contestId = metadataContext.metadata && metadataContext.metadata.contestId
          ? metadataContext.metadata.contestId
          : (problem && state.contestWorkspace && state.contestWorkspace.contest ? state.contestWorkspace.contest.id : undefined);
        if (contestId) {
          const contest = getContestById(state, contestId);
          if (!canContestSubmitRemotely(contest)) {
            vscode.window.showWarningMessage(buildContestSubmitBlockedMessage(contest));
            return;
          }
          contestPassword = resolveContestPassword(state, contestId);
          if (!contestPassword) {
            contestPassword = await vscode.window.showInputBox({
              prompt: "如果比赛提交需要密码，请输入比赛密码",
              password: true,
              ignoreFocusOut: true
            });
            if (contestPassword === undefined) {
              return;
            }
          }
        }
        const submission = await client.submitSolution({
          problem_id: problemId,
          contest_id: contestId || undefined,
          contest_password: contestPassword || undefined,
          language,
          code: document.getText()
        });
        if (contestId && contestPassword) {
          cacheContestPassword(state, contestId, contestPassword);
        }
        if (!usedActiveEditor) {
          outputChannel.appendLine(`提交时自动使用当前题目工作区源码：${sourcePath}`);
        }
        vscode.window.showInformationMessage(`已创建提交 ${submission.submission_id}，正在等待判题结果...`);
        const result = await waitForSubmission(client, submission.submission_id);
        const submissionResult = Object.assign({}, result, {
          title: metadataContext.metadata ? metadataContext.metadata.title : (state.activeProblem ? state.activeProblem.title : ""),
          displayId: result.display_id || (metadataContext.metadata ? metadataContext.metadata.displayId : ""),
          language,
          baseUrl: metadataContext.metadata ? metadataContext.metadata.baseUrl || client.baseUrl : client.baseUrl,
          contestId: contestId || null,
          problemId
        });
        await saveSubmissionHistory(context, state, submissionResult, {
          title: submissionResult.title,
          displayId: submissionResult.displayId,
          language: submissionResult.language,
          baseUrl: submissionResult.baseUrl,
          contestId: submissionResult.contestId,
          problemId: submissionResult.problemId
        });
        await updateProblemProgress(
          context,
          state,
          buildProblemProgressRef(
            metadataContext.metadata ? metadataContext.metadata.baseUrl || client.baseUrl : client.baseUrl,
            {
              id: problemId,
              display_id: result.display_id || (metadataContext.metadata ? metadataContext.metadata.displayId : ""),
              title: metadataContext.metadata ? metadataContext.metadata.title : (state.activeProblem ? state.activeProblem.title : "")
            },
            contestId ? { id: contestId, title: metadataContext.metadata ? metadataContext.metadata.contestTitle : (state.contestWorkspace ? state.contestWorkspace.contest.title : "") } : null
          ),
          {
            workspaceCreated: true,
            language,
            sourceFile: path.basename(sourcePath),
            lastSubmissionId: result.id,
            lastSubmissionLabel: result.result_label,
            accepted: ACCEPTED_RESULTS.has(result.result_label)
          }
        );
        await showSubmissionResultPanel(context, state, client, submissionResult);
        treeProvider.refresh();
        await refreshProblemPanel(state, client);
        await persistWorkbenchLayout(context, state);
        vscode.window.showInformationMessage(`判题结果：${result.result_label}`);
      } catch (error) {
        const rawMessage = String(error && error.message ? error.message : error);
        if (/Problem does not exist/i.test(rawMessage)) {
          vscode.window.showErrorMessage("提交失败：当前本地题目元数据里的题号在站点上不存在。插件已经在提交前做过校验；如果你仍看到这个错误，请重新从题库或比赛打开这道题后再提交。");
          return;
        }
        vscode.window.showErrorMessage(localizeServerErrorMessage(rawMessage));
      }
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showLastSubmissionResult", async () => {
    if (!state.lastSubmissionResult) {
      vscode.window.showInformationMessage("还没有最近的提交结果记录");
      return;
    }
    state.resultPanelFocus = {
      problemRef: buildResultProblemRefFromRecord(state.lastSubmissionResult),
      submission: state.lastSubmissionResult,
      mode: "latest-submission"
    };
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showLastLocalReport", async () => {
    if (!state.lastLocalReport) {
      vscode.window.showInformationMessage("还没有最近的本地验收报告");
      return;
    }
    state.resultPanelFocus = {
      problemRef: buildResultProblemRefFromRecord(state.lastLocalReport),
      mode: "local-report"
    };
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showCurrentProblemLatestResult", async () => {
    const problemRef = await resolveResultPanelProblemRef(client, state);
    if (!problemRef) {
      vscode.window.showInformationMessage("当前没有可定位的题目结果");
      return;
    }
    const latestSubmission = pickSubmissionResultForProblem(state, problemRef, null);
    state.resultPanelFocus = {
      problemRef,
      submission: latestSubmission || null,
      mode: latestSubmission ? "latest-submission" : "current-problem"
    };
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.pickProblemHistorySubmission", async () => {
    const problemRef = await resolveResultPanelProblemRef(client, state);
    if (!problemRef) {
      vscode.window.showInformationMessage("当前没有可定位的题目结果");
      return;
    }
    const history = getSubmissionHistoryForProblem(state, problemRef);
    if (!history.length) {
      vscode.window.showInformationMessage("这道题还没有历史提交记录");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      history.map((item) => ({
        label: `提交 #${item.id} · ${item.result_label || "未知结果"}`,
        description: [item.language || "", item.submittedAt || ""].filter(Boolean).join(" · "),
        item
      })),
      {
        title: "选择一条历史提交结果",
        placeHolder: "切换结果报表到指定历史提交"
      }
    );
    if (!picked) {
      return;
    }
    state.lastSubmissionResult = Object.assign({}, picked.item);
    await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, state.lastSubmissionResult);
    state.resultPanelFocus = {
      problemRef: buildResultProblemRefFromRecord(picked.item),
      submission: picked.item,
      mode: "history-submission"
    };
    await showResultPanel(state, client);
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showAdjacentHistorySubmission", async (direction) => {
    if (!state.resultPanelFocus || state.resultPanelFocus.mode !== "history-submission" || !state.resultPanelFocus.submission) {
      vscode.window.showInformationMessage("请先打开一条历史提交结果");
      return;
    }
    const problemRef = state.resultPanelFocus.problemRef || buildResultProblemRefFromRecord(state.resultPanelFocus.submission);
    const navigation = getHistorySubmissionNavigation(state, problemRef, state.resultPanelFocus.submission);
    const target = direction === "newer" ? navigation.newer : navigation.older;
    if (!target) {
      vscode.window.showInformationMessage(direction === "newer" ? "已经是最新的历史提交" : "已经是最早的历史提交");
      return;
    }
    state.lastSubmissionResult = Object.assign({}, target);
    await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, state.lastSubmissionResult);
    state.resultPanelFocus = {
      problemRef: buildResultProblemRefFromRecord(target),
      submission: target,
      mode: "history-submission"
    };
    await showResultPanel(state, client);
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showResultPanel", async (payload) => {
    const explicitProblemRef = buildResultProblemRefFromPayload(payload, state, client);
    if (explicitProblemRef) {
      state.resultPanelFocus = {
        problemRef: explicitProblemRef,
        mode: "current-problem"
      };
    } else {
      state.resultPanelFocus = null;
    }
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openSubmissionHistoryEntry", async (item) => {
    if (!item) {
      return;
    }
    state.lastSubmissionResult = Object.assign({}, item);
    await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, state.lastSubmissionResult);
    state.resultPanelFocus = {
      problemRef: buildResultProblemRefFromRecord(item),
      submission: item,
      mode: "history-submission"
    };
    await showResultPanel(state, client);
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.manageSubmissionHistory", async () => {
    await manageSubmissionHistory(context, state, client, treeProvider);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.toggleRecentSubmissionScope", async () => {
    state.recentSubmissionScope = state.recentSubmissionScope === "current" ? "all" : "current";
    await context.globalState.update(RECENT_SUBMISSION_SCOPE_KEY, state.recentSubmissionScope);
    treeProvider.refresh();
    vscode.window.showInformationMessage(
      state.recentSubmissionScope === "current"
        ? "最近提交已切换为只看当前题"
        : "最近提交已切换为显示全部题"
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.toggleRecentSubmissionDensity", async () => {
    state.recentSubmissionDensity = state.recentSubmissionDensity === "latest-only" ? "all" : "latest-only";
    await context.globalState.update(RECENT_SUBMISSION_DENSITY_KEY, state.recentSubmissionDensity);
    treeProvider.refresh();
    vscode.window.showInformationMessage(
      state.recentSubmissionDensity === "latest-only"
        ? "最近提交已切换为每题仅显示最近一次"
        : "最近提交已切换为显示每题全部提交"
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.toggleRecentSubmissionResultFilter", async () => {
    const order = ["all", "non-ac", "errors-only"];
    const currentIndex = order.indexOf(state.recentSubmissionResultFilter || "all");
    state.recentSubmissionResultFilter = order[(currentIndex + 1) % order.length];
    await context.globalState.update(RECENT_SUBMISSION_RESULT_FILTER_KEY, state.recentSubmissionResultFilter);
    treeProvider.refresh();
    const messageMap = {
      all: "最近提交已切换为显示全部结果",
      "non-ac": "最近提交已切换为仅显示未 AC 结果",
      "errors-only": "最近提交已切换为仅显示 CE/RE/SE 等异常结果"
    };
    vscode.window.showInformationMessage(messageMap[state.recentSubmissionResultFilter]);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.toggleRecentSubmissionLanguageFilter", async () => {
    const languages = Array.from(new Set((state.submissionHistory || []).map((item) => item.language).filter(Boolean)));
    const order = ["all"].concat(languages);
    const currentIndex = Math.max(order.indexOf(state.recentSubmissionLanguageFilter || "all"), 0);
    state.recentSubmissionLanguageFilter = order[(currentIndex + 1) % order.length];
    await context.globalState.update(RECENT_SUBMISSION_LANGUAGE_FILTER_KEY, state.recentSubmissionLanguageFilter);
    treeProvider.refresh();
    vscode.window.showInformationMessage(
      state.recentSubmissionLanguageFilter === "all"
        ? "最近提交已切换为显示全部语言"
        : `最近提交已切换为仅显示 ${state.recentSubmissionLanguageFilter}`
    );
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showCurrentProblemDescription", async () => {
    try {
      const sourceContext = await resolveSourceContext(client, state);
      if (!sourceContext || !sourceContext.metadataContext.metadata) {
        vscode.window.showWarningMessage("请先打开 XMUOJ 题目源码文件，或者先打开一道题");
        return;
      }
      const metadata = sourceContext.metadataContext.metadata;
      const contest = metadata.contestId ? { id: metadata.contestId, title: metadata.contestTitle } : null;
      const detail = await openProblemDetail(client, state, {
        id: metadata.problemId,
        display_id: metadata.displayId,
        title: metadata.title
      }, contest, state.contestPassword || undefined);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.materializeContestWorkspace", async () => {
    try {
      await materializeContestWorkspace(context, client, state, outputChannel);
      treeProvider.refresh();
    } catch (error) {
      outputChannel.appendLine(error.stack || error.message);
      outputChannel.show(true);
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.initContestWorkspace", async (workspaceEntry) => {
    try {
      if (workspaceEntry && workspaceEntry.contest) {
        syncActiveContestByEntry(state, workspaceEntry);
        updateStatusBars(state, userStatusBar, contestStatusBar, client);
        treeProvider.refresh();
      }
      const targetContest = workspaceEntry && workspaceEntry.contest
        ? workspaceEntry.contest
        : (state.contestWorkspace ? state.contestWorkspace.contest : null);
      if (targetContest) {
        const confirmed = await vscode.window.showWarningMessage(
          `将为实验「${targetContest.title}」批量创建题目目录，确认继续吗？`,
          { modal: true },
          "继续"
        );
        if (confirmed !== "继续") {
          return;
        }
      }
      await initContestProblemFolders(context, client, state, outputChannel, workspaceEntry);
      treeProvider.refresh();
    } catch (error) {
      outputChannel.appendLine(error.stack || error.message);
      outputChannel.show(true);
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.revealProblemWorkspaceEntry", async (item) => {
    let fullPath;
    
    if (item) {
      if (item.entry && item.entry.fullPath) {
        fullPath = item.entry.fullPath;
      } else if (item.fullPath) {
        fullPath = item.fullPath;
      } else if (item.fsPath) {
        fullPath = item.fsPath;
      }
    }
    
    if (!fullPath && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document) {
      fullPath = vscode.window.activeTextEditor.document.uri.fsPath;
    }
    
    if (!fullPath) {
      vscode.window.showWarningMessage("无法在资源管理器中定位：未找到有效的文件路径，请先打开一个文件");
      return;
    }
    
    try {
      const uri = vscode.Uri.file(fullPath);
      await vscode.commands.executeCommand("revealFileInOS", uri);
    } catch (error) {
      vscode.window.showErrorMessage(`无法在资源管理器中定位：${error.message || error}`);
    }
  }));

  context.subscriptions.push(outputChannel, userStatusBar, contestStatusBar);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
