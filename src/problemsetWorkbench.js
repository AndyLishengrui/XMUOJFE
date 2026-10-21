/**
 * 公共题库刷题台的扩展侧控制器。
 *
 * 页面只负责渲染；题目目录、个人进度、排名与关注的权威状态都在这里。
 * 竞速只存在于题库实验，由 ContestRaceWorkbench 单独处理。
 * 所有站点数据通过 siteApi（即 client.request）获取，失败时退回缓存与本地进度。
 */
"use strict";

const vscode = require("vscode");
const fs = require("fs/promises");
const path = require("path");

const { createSiteApi, normalizeProblem } = require("./siteApi");
const catalog = require("./problemsetCatalog");
const queueLib = require("./problemsetQueue");
const ranking = require("./problemsetRanking");
const { fnv1a } = require("./problemsetRace");
const insights = require("./problemsetInsights");

const UI_KEY = "xmuoj.problemsetWorkbench.ui";
const FOLLOWS_KEY = "xmuoj.followedUsers";
const QUEUE_CURSOR_KEY = "xmuoj.problemsetQueueCursor.v1";
const PROGRESS_KEY = "xmuoj.problemProgress";

const CATALOG_CACHE_VERSION = 1;
const RANK_TTL_MS = 10 * 60 * 1000;
const PROFILE_TTL_MS = 5 * 60 * 1000;
const FOLLOW_TTL_MS = 5 * 60 * 1000;
const PROBLEM_BOARD_TTL_MS = 10 * 60 * 1000;

const TABS = ["overview", "problems", "ranking", "following"];

const DEFAULT_UI = Object.freeze({
  tab: "overview",
  filters: { status: "all", difficulty: "all", tag: "all", keyword: "" },
  sort: "default",
  page: 1,
  pageSize: 50,
  rankRule: "acm"
});

function normalizeUi(raw, defaultPageSize = DEFAULT_UI.pageSize) {
  const source = raw && typeof raw === "object" ? raw : {};
  const filters = source.filters && typeof source.filters === "object" ? source.filters : {};
  const pageSize = Math.min(200, Math.max(10, Number(source.pageSize) || defaultPageSize));
  return {
    tab: TABS.includes(source.tab) ? source.tab : DEFAULT_UI.tab,
    filters: {
      status: typeof filters.status === "string" ? filters.status : "all",
      difficulty: typeof filters.difficulty === "string" ? filters.difficulty : "all",
      tag: typeof filters.tag === "string" ? filters.tag : "all",
      keyword: typeof filters.keyword === "string" ? filters.keyword.slice(0, 100) : ""
    },
    sort: typeof source.sort === "string" ? source.sort : "default",
    page: Math.max(1, Number(source.page) || 1),
    pageSize,
    rankRule: source.rankRule === "oi" ? "oi" : "acm"
  };
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.round(number * 10) / 10;
}

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

class ProblemsetWorkbench {
  /**
   * @param {object} options
   * @param {import("vscode").ExtensionContext} options.context
   * @param {object} options.state 扩展的共享状态（含 problemsetSelections）
   * @param {object} options.actions 回调：getClient/getUsername/openProblem/...
   * @param {import("vscode").OutputChannel} [options.outputChannel]
   */
  constructor(options) {
    this.context = options.context;
    this.state = options.state;
    this.actions = options.actions || {};
    this.outputChannel = options.outputChannel || null;

    this.panel = null;
    this.visible = false;
    this.disposed = false;

    const config = vscode.workspace.getConfiguration("xmuoj");
    const configuredPageSize = Math.min(
      200,
      Math.max(10, Number(config.get("problemset.pageSize", 50)) || 50)
    );
    this.catalogTtlMs =
      Math.max(1, Number(config.get("problemset.catalogTtlMinutes", 30)) || 30) * 60 * 1000;

    this.ui = normalizeUi(this.context.globalState.get(UI_KEY, {}), configuredPageSize);
    this.follows = this._readFollows();

    this.profile = null;
    this.profileFetchedAt = 0;
    this.identityError = "";
    this.solvedSet = new Set();
    this.attemptedSet = new Set();

    this.rawProblems = [];
    this.problems = [];
    this.problemIndex = new Map();
    this.catalogMeta = { source: "none", fetchedAt: 0, error: "", total: 0, stale: false };
    this.catalogPromise = null;

    this.rankState = {
      acm: { index: null, fetchedAt: 0, error: "", loading: false },
      oi: { index: null, fetchedAt: 0, error: "", loading: false }
    };

    this.recentSubmissions = [];
    this.recentSubmissionsFetchedAt = 0;
    this.myContests = [];
    this.myContestsFetchedAt = 0;
    this.followDetails = new Map();
    this.problemBoards = new Map();

    this.capsules = [];
    this.capsulesLoading = false;
    this.capsulesError = "";

    this.uiSaveTimer = null;

    this.loadingSlices = new Set();
    this.sliceErrors = new Map();
  }

  // ---------------------------------------------------------------- helpers

  get baseUrl() {
    const client = this.actions.getClient ? this.actions.getClient() : null;
    return client ? String(client.baseUrl || "").replace(/\/+$/, "") : "";
  }

  get me() {
    if (this.profile && this.profile.username) {
      return this.profile.username;
    }
    return this.actions.getUsername ? String(this.actions.getUsername() || "") : "";
  }

  api() {
    const client = this.actions.getClient ? this.actions.getClient() : null;
    return client ? createSiteApi(client) : null;
  }

  log(message) {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[刷题台] ${message}`);
    }
  }

  _readFollows() {
    const raw = this.context.globalState.get(FOLLOWS_KEY, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    const seen = new Set();
    const list = [];
    for (const entry of raw) {
      const username = String(entry || "").trim();
      const key = username.toLowerCase();
      if (!username || seen.has(key)) {
        continue;
      }
      seen.add(key);
      list.push(username);
    }
    return list.slice(0, 50);
  }

  async _saveFollows() {
    await this.context.globalState.update(FOLLOWS_KEY, this.follows.slice());
  }

  _readQueueCursor() {
    return String(this.context.globalState.get(QUEUE_CURSOR_KEY, "") || "");
  }

  async _saveUi() {
    if (this.uiSaveTimer) {
      clearTimeout(this.uiSaveTimer);
    }
    this.uiSaveTimer = setTimeout(() => {
      this.uiSaveTimer = null;
      this.context.globalState.update(UI_KEY, this.ui).catch(() => null);
    }, 250);
  }

  _cachePath() {
    const storage = this.context.globalStorageUri && this.context.globalStorageUri.fsPath;
    if (!storage) {
      return "";
    }
    const key = fnv1a(this.baseUrl || "default");
    return path.join(storage, `problemset-catalog-${key}.json`);
  }

  async _readCatalogCache() {
    const file = this._cachePath();
    if (!file) {
      return null;
    }
    try {
      const text = await fs.readFile(file, "utf8");
      const data = JSON.parse(text);
      if (!data || data.version !== CATALOG_CACHE_VERSION || !Array.isArray(data.problems)) {
        return null;
      }
      return data;
    } catch (_error) {
      return null;
    }
  }

  async _writeCatalogCache() {
    const file = this._cachePath();
    if (!file) {
      return;
    }
    const payload = {
      version: CATALOG_CACHE_VERSION,
      baseUrl: this.baseUrl,
      fetchedAt: this.catalogMeta.fetchedAt,
      total: this.catalogMeta.total,
      problems: this.rawProblems.map((problem) => ({
        id: problem.id,
        displayId: problem.displayId,
        title: problem.title,
        difficulty: problem.difficulty,
        tags: problem.tags,
        source: problem.source,
        acceptedNumber: problem.acceptedNumber,
        submissionNumber: problem.submissionNumber
      }))
    };
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(payload), "utf8");
    } catch (error) {
      this.log(`写入题目缓存失败：${error.message}`);
    }
  }

  _localIndex() {
    let map = {};
    try {
      map = this.context.globalState.get(PROGRESS_KEY, {}) || {};
    } catch (_error) {
      map = {};
    }
    return catalog.buildLocalProgressIndex(map, this.baseUrl);
  }

  _applyStatuses() {
    const solvedSet = this.solvedSet;
    const attemptedSet = this.attemptedSet;
    const serverAvailable = this.catalogMeta.source === "server" || this.catalogMeta.source === "cache";
    const withServer = this.rawProblems.map((problem) =>
      normalizeProblem(Object.assign({}, problem, { _id: problem.displayId }), {
        solvedSet,
        attemptedSet
      })
    );
    this.problems = catalog.mergeCatalogWithLocal(withServer, {
      localIndex: this._localIndex(),
      serverAvailable
    });
    this.problemIndex = new Map();
    for (const problem of this.problems) {
      this.problemIndex.set(String(problem.id), problem);
      if (problem.displayId) {
        this.problemIndex.set(String(problem.displayId), problem);
      }
    }
  }

  resolveProblem(identifier) {
    const key = String(identifier === undefined || identifier === null ? "" : identifier);
    if (!key) {
      return null;
    }
    if (this.problemIndex.has(key)) {
      return this.problemIndex.get(key);
    }
    // 队列项可能只有数字 id；目录未加载时用最小信息兜底。
    const item = queueLib
      .filterSelections(this.state.problemsetSelections || [], this.baseUrl)
      .find((entry) => String(entry.id) === key || String(entry.display_id) === key);
    if (!item) {
      return null;
    }
    return {
      id: item.id,
      displayId: item.display_id || item.displayId || "",
      title: item.title || "",
      difficulty: item.difficulty || "",
      tags: Array.isArray(item.languages) ? [] : [],
      status: "todo",
      statusSource: "local"
    };
  }

  _problemPayload(problem) {
    if (!problem) {
      return null;
    }
    const queueKeys = new Set(
      queueLib
        .filterSelections(this.state.problemsetSelections || [], this.baseUrl)
        .map((item) => String(item.id))
    );
    return {
      id: problem.id,
      displayId: problem.displayId,
      title: problem.title,
      difficulty: problem.difficulty,
      tags: problem.tags || [],
      acceptedNumber: problem.acceptedNumber || 0,
      submissionNumber: problem.submissionNumber || 0,
      passRate: problem.passRate === undefined ? formatPercent(
        problem.submissionNumber > 0 ? (problem.acceptedNumber / problem.submissionNumber) * 100 : null
      ) : problem.passRate,
      status: catalog.effectiveStatus(problem),
      statusSource: problem.statusSource || "local",
      conflict: Boolean(problem.conflict),
      localLabel: problem.local && problem.local.lastSubmissionLabel ? problem.local.lastSubmissionLabel : "",
      inQueue: queueKeys.has(String(problem.id))
    };
  }

  // ----------------------------------------------------------------- panel

  async open() {
    if (this.disposed) {
      return;
    }
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two, false);
      this.visible = true;
      this.postAll();
      await this.refreshAll({ force: false });
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "xmuojProblemsetWorkbench",
      "XMUOJ 刷题台",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
      }
    );
    this.panel = panel;
    this.visible = true;
    this.state.problemsetPanel = panel;
    panel.webview.html = this._html(panel.webview);
    panel.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message).catch((error) => {
        this.log(`消息处理失败：${error && error.stack ? error.stack : error}`);
        this.postToast("error", error && error.message ? error.message : "操作失败");
      });
    });
    if (typeof panel.onDidChangeViewState === "function") {
      panel.onDidChangeViewState((event) => {
        this.visible = Boolean(event.webviewPanel.visible);
        if (this.visible) {
          this.postAll();
        }
      });
    }
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = null;
      }
      if (this.state.problemsetPanel === panel) {
        this.state.problemsetPanel = null;
      }
      this.visible = false;
    });
    this.postAll();
    await this.refreshAll({ force: false });
  }

  _html(webview) {
    const nonce = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 62)
      )
    ).join("");
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media", "problemset");
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "styles.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "app.js"));
    let html = "";
    try {
      const file = path.join(this.context.extensionPath, "media", "problemset", "index.html");
      // 同步读取在面板创建时只发生一次，文件很小。
      html = require("fs").readFileSync(file, "utf8");
    } catch (error) {
      this.log(`读取刷题台页面失败：${error.message}`);
      html = "<!doctype html><html><body>刷题台页面缺失，请重新安装插件。</body></html>";
    }
    return html
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{styleUri}}/g, String(styleUri))
      .replace(/{{scriptUri}}/g, String(scriptUri));
  }

  dispose() {
    this.disposed = true;
    if (this.uiSaveTimer) {
      clearTimeout(this.uiSaveTimer);
      this.uiSaveTimer = null;
      this.context.globalState.update(UI_KEY, this.ui).catch(() => null);
    }
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }

  post(message) {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage(message).then(undefined, () => null);
  }

  postToast(level, message) {
    this.post({ type: "toast", level, message });
  }

  postLoading(slice, requestId) {
    this.post({ type: "loading", slice, requestId });
  }

  postError(slice, error, requestId) {
    const kind = (error && error.kind) || "server";
    this.sliceErrors.set(slice, error && error.message ? error.message : String(error));
    this.post({
      type: "error",
      slice,
      kind,
      message: error && error.message ? error.message : String(error),
      retryable: kind !== "auth",
      requestId
    });
  }

  postSnapshot(slice, data, meta = {}, requestId) {
    this.post({ type: "snapshot", slice, data, meta: Object.assign({
      source: this.catalogMeta.source,
      fetchedAt: this.catalogMeta.fetchedAt,
      stale: Boolean(this.catalogMeta.stale),
      error: this.catalogMeta.error || ""
    }, meta), requestId });
  }

  postQueue() {
    this.post({
      type: "queue",
      items: queueLib.filterSelections(this.state.problemsetSelections || [], this.baseUrl),
      cursor: this._readQueueCursor()
    });
  }

  postAuth() {
    this.post({ type: "auth", username: this.me || null, baseUrl: this.baseUrl });
  }

  /** 队列被其他命令修改后，让页面同步一次。 */
  refreshQueueView() {
    this.postQueue();
    this.postSnapshot("problems", this._problemsSlice());
  }

  /** 登录/登出后重新同步身份与个人数据。 */
  async refreshIdentity() {
    this.profile = null;
    this.profileFetchedAt = 0;
    this.recentSubmissionsFetchedAt = 0;
    this.myContestsFetchedAt = 0;
    this.solvedSet = new Set();
    this.attemptedSet = new Set();
    await this.loadIdentity(true);
    this._applyStatuses();
    await this.loadOverviewExtras(true);
    this.postAll();
  }

  // ------------------------------------------------------------- snapshots

  _rankView(rule) {
    const state = this.rankState[rule] || this.rankState.acm;
    if (!state.index) {
      return {
        rule,
        loading: Boolean(state.loading),
        error: state.error || "",
        status: "loading",
        rank: null,
        position: null,
        total: 0,
        percentile: null,
        rows: []
      };
    }
    const username = this.me;
    const located = username
      ? ranking.locateRank(state.index, username)
      : { status: "not_found", rank: null, position: null, total: state.index.total };
    return {
      rule,
      loading: Boolean(state.loading),
      error: state.error || "",
      status: located.status,
      rank: located.rank,
      position: located.position,
      tieStart: located.tieStart,
      tieEnd: located.tieEnd,
      total: state.index.total || located.total,
      truncated: Boolean(state.index.truncated),
      percentile: located.rank ? ranking.rankPercentile(located.rank, state.index.total) : null,
      rows: state.index.rows.slice(0, 50).map((row) => ({
        position: row.position,
        username: row.username,
        school: row.school || "",
        acceptedNumber: row.acceptedNumber,
        submissionNumber: row.submissionNumber,
        totalScore: row.totalScore,
        passRate: row.submissionNumber > 0
          ? Math.round((row.acceptedNumber / row.submissionNumber) * 1000) / 10
          : null,
        following: this.follows.some((name) => name.toLowerCase() === row.username.toLowerCase())
      }))
    };
  }

  _followCard(username) {
    const cached = this.followDetails.get(username.toLowerCase());
    const rankRow = this.rankState.acm.index
      ? ranking.locateRank(this.rankState.acm.index, username)
      : null;
    const row = rankRow && rankRow.row ? rankRow.row : null;
    return {
      username,
      avatar: (cached && cached.avatar) || (row && row.avatar) || "",
      acceptedNumber: cached && cached.profile ? cached.profile.acceptedNumber : row ? row.acceptedNumber : null,
      submissionNumber: cached && cached.profile ? cached.profile.submissionNumber : row ? row.submissionNumber : null,
      totalScore: cached && cached.profile ? cached.profile.totalScore : row ? row.totalScore : null,
      rank: rankRow && rankRow.rank ? rankRow.rank : null,
      position: row ? row.position : null,
      recentSubmission: cached && cached.recentSubmission ? cached.recentSubmission : null,
      contests: cached && cached.contests ? cached.contests : [],
      error: cached && cached.error ? cached.error : "",
      loading: Boolean(cached && cached.loading)
    };
  }

  _problemBoardView(displayId) {
    const key = String(displayId || "");
    const cached = this.problemBoards.get(key);
    const meta = this.problemIndex.get(key);
    const board = cached && cached.board ? cached.board : null;
    return {
      displayId: key,
      problem: meta
        ? {
            displayId: meta.displayId,
            title: meta.title,
            difficulty: meta.difficulty,
            status: catalog.effectiveStatus(meta)
          }
        : null,
      loading: Boolean(cached && cached.loading),
      error: cached && cached.error ? cached.error : "",
      fetchedAt: cached ? Number(cached.fetchedAt) || 0 : 0,
      rows: board ? board.rows : [],
      fastest: board ? board.fastest : [],
      mostAccepted: board ? board.mostAccepted : [],
      speedAvailable: Boolean(board && board.speedAvailable),
      recent: board ? board.recent : [],
      submissionTotal: board
        ? board.submissionTotal
        : meta
          ? meta.submissionNumber
          : 0,
      acTotal: board ? board.acTotal : meta ? meta.acceptedNumber : 0,
      passRate: board
        ? board.passRate
        : meta
          ? meta.passRate
          : null,
      uniqueAcceptedUsers: board ? board.uniqueAcceptedUsers : null,
      truncated: Boolean(board && board.truncated)
    };
  }

  async loadProblemBoard(displayId, options = {}) {
    const key = String(displayId || "").trim();
    if (!key) {
      return;
    }
    const cached = this.problemBoards.get(key);
    if (!options.force && cached && Date.now() - cached.fetchedAt < PROBLEM_BOARD_TTL_MS) {
      this.postSnapshot("problemBoard", this._problemBoardView(key));
      return;
    }
    this.problemBoards.set(
      key,
      Object.assign({}, cached || {}, {
        board: (cached && cached.board) || null,
        fetchedAt: cached ? Number(cached.fetchedAt) || 0 : 0,
        error: "",
        loading: true
      })
    );
    this.postSnapshot("problemBoard", this._problemBoardView(key));
    const api = this.api();
    if (!api) {
      this.problemBoards.set(
        key,
        Object.assign({}, this.problemBoards.get(key), {
          loading: false,
          error: "站点接口不可用"
        })
      );
      this.postSnapshot("problemBoard", this._problemBoardView(key));
      return;
    }
    const allTask =
      typeof api.getProblemSubmissions === "function"
        ? api.getProblemSubmissions(key, { pageSize: 250, maxPages: 10 })
        : Promise.reject(new Error("站点接口不支持本题提交记录"));
    const [allResult, acCountResult] = await Promise.allSettled([
      allTask,
      api.getSubmissions({ problemId: key, result: 0, limit: 1 })
    ]);
    let allPage = allResult.status === "fulfilled" ? allResult.value : null;
    let acPage = null;
    let recentPage = null;
    let error = "";
    if (!allPage) {
      // 旧接口或整题提交拉取失败时，退回“AC 提交 + 最近 250 条”。
      const [acResult, recentResult] = await Promise.allSettled([
        typeof api.getProblemAcSubmissions === "function"
          ? api.getProblemAcSubmissions(key, { pageSize: 250, maxPages: 8 })
          : Promise.resolve({ results: [], total: 0, truncated: false }),
        api.getSubmissions({ problemId: key, limit: 250 })
      ]);
      acPage =
        acResult.status === "fulfilled"
          ? acResult.value
          : { results: [], total: 0, truncated: false };
      recentPage =
        recentResult.status === "fulfilled"
          ? recentResult.value
          : { results: [], total: 0 };
      if (acResult.status === "rejected" && recentResult.status === "rejected") {
        const reason = recentResult.reason || acResult.reason;
        error = reason && reason.message ? reason.message : "本题数据加载失败";
      } else {
        error = "部分数据加载失败";
      }
    } else if (acCountResult.status === "rejected") {
      error = "部分数据加载失败";
    }
    const acTotal =
      acCountResult.status === "fulfilled"
        ? acCountResult.value.total
        : acPage
          ? acPage.total
          : allPage.results.filter((row) => row.resultKey === "AC").length;
    const submissionTotal = allPage ? allPage.total : recentPage.total;
    const recentSubmissions = allPage
      ? allPage.results.slice(0, 50)
      : recentPage.results;
    const board = insights.buildProblemLeaderboard({
      submissions: allPage ? allPage.results : undefined,
      acSubmissions: acPage ? acPage.results : undefined,
      recentSubmissions,
      acTotal,
      submissionTotal,
      truncated: allPage ? allPage.truncated : acPage.truncated
    });
    this.problemBoards.set(key, {
      board,
      fetchedAt: Date.now(),
      error,
      loading: false
    });
    this.postSnapshot("problemBoard", this._problemBoardView(key));
  }

  _overviewSlice() {
    const stats = catalog.computeCatalogStats(this.problems);
    const profile = this.profile;
    return {
      loggedIn: Boolean(profile),
      username: this.me || "",
      profile: profile
        ? {
            username: profile.username,
            avatar: profile.avatar,
            school: profile.school,
            acceptedNumber: profile.acceptedNumber,
            submissionNumber: profile.submissionNumber,
            totalScore: profile.totalScore,
            passRate:
              profile.submissionNumber > 0
                ? Math.round((profile.acceptedNumber / profile.submissionNumber) * 1000) / 10
                : null
          }
        : null,
      rank: this._rankView(this.ui.rankRule),
      rankRule: this.ui.rankRule,
      stats,
      difficultyStats: catalog.computeDifficultyStats(this.problems),
      recentSubmissions: this.recentSubmissions.slice(0, 10),
      contests: this.myContests.slice(0, 5),
      follows: this.follows.slice(0, 5).map((username) => this._followCard(username)),
      catalogError: this.catalogMeta.error || "",
      catalogLoaded: this.problems.length > 0,
      identityError: this.identityError || ""
    };
  }

  _capsulesSlice() {
    return {
      items: this.capsules.map((entry) => ({
        id: entry.id,
        problem: entry.problem || {},
        file: entry.file || "",
        language: entry.language || "",
        startedAt: entry.startedAt || "",
        endedAt: entry.endedAt || null,
        durationMs: Number(entry.durationMs) || 0,
        result: entry.result || null,
        eventCount: Number(entry.eventCount) || 0,
        sizeBytes: Number(entry.sizeBytes) || 0
      })),
      loading: this.capsulesLoading,
      error: this.capsulesError || ""
    };
  }

  async loadCapsules() {
    if (!this.actions.listCapsules) {
      return;
    }
    this.capsulesLoading = true;
    this.capsulesError = "";
    this.postSnapshot("capsules", this._capsulesSlice());
    try {
      const entries = await this.actions.listCapsules();
      this.capsules = Array.isArray(entries) ? entries : [];
    } catch (error) {
      this.capsulesError = error && error.message ? error.message : String(error);
    } finally {
      this.capsulesLoading = false;
      this.postSnapshot("capsules", this._capsulesSlice());
    }
  }

  _problemsSlice() {
    const filtered = catalog.sortProblems(
      catalog.applyFilters(this.problems, this.ui.filters),
      this.ui.sort
    );
    const page = catalog.paginate(filtered, this.ui.page, this.ui.pageSize);
    return {
      items: page.items.map((problem) => this._problemPayload(problem)),
      page: page.page,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
      filteredTotal: filtered.length,
      stats: catalog.computeCatalogStats(this.problems),
      difficultyStats: catalog.computeDifficultyStats(this.problems),
      tags: catalog.computeTopTags(this.problems, 40),
      filters: this.ui.filters,
      sort: this.ui.sort
    };
  }

  postAll() {
    this.postQueue();
    this.postAuth();
    this.postSnapshot("overview", this._overviewSlice());
    this.postSnapshot("problems", this._problemsSlice());
    this.postSnapshot("ranking", this._rankView(this.ui.rankRule));
    this.postSnapshot("following", {
      users: this.follows.map((username) => this._followCard(username))
    });
    this.postSnapshot("capsules", this._capsulesSlice());
    this.post({ type: "ui", ui: this.ui });
  }

  _postSlice(slice) {
    if (slice === "overview") {
      this.postSnapshot("overview", this._overviewSlice());
    } else if (slice === "problems") {
      this.postSnapshot("problems", this._problemsSlice());
    } else if (slice === "ranking") {
      this.postSnapshot("ranking", this._rankView(this.ui.rankRule));
    } else if (slice === "following") {
      this.postSnapshot("following", {
        users: this.follows.map((username) => this._followCard(username))
      });
    } else if (slice === "capsules") {
      this.postSnapshot("capsules", this._capsulesSlice());
    } else if (slice === "queue") {
      this.postQueue();
    }
  }

  // --------------------------------------------------------------- loading

  async refreshAll(options = {}) {
    await Promise.allSettled([
      this.loadIdentity(options.force),
      this.loadCatalog({ force: options.force }),
      this.loadRank(this.ui.rankRule, options.force)
    ]);
    await this.loadOverviewExtras(options.force);
    this.postAll();
  }

  async loadIdentity(force = false) {
    if (!force && this.profile && Date.now() - this.profileFetchedAt < PROFILE_TTL_MS) {
      return this.profile;
    }
    const api = this.api();
    if (!api) {
      return null;
    }
    this.postLoading("overview");
    try {
      let profile = await api.getProfile();
      if (!profile && this.actions.getUsername) {
        const username = String(this.actions.getUsername() || "");
        if (username) {
          profile = await api.getProfile(username);
        }
      }
      if (!profile) {
        this.identityError = "未登录，已做状态仅来自本地记录";
        this.profile = null;
        this.profileFetchedAt = Date.now();
        this.sliceErrors.delete("overview");
        return null;
      }
      this.profile = profile;
      this.profileFetchedAt = Date.now();
      this.identityError = "";
      this.solvedSet = new Set(profile.solvedSet);
      this.attemptedSet = new Set(profile.attemptedSet);
      // profile 没覆盖所有 AC 提交时再补一次（例如站点关闭了状态表）。
      if (this.solvedSet.size === 0 && profile.acceptedNumber > 0) {
        await this._fillSolvedFromSubmissions(profile.username);
      }
      this.sliceErrors.delete("overview");
      this._applyStatuses();
      this.log(`已同步 ${profile.username}：AC ${profile.acceptedNumber}，提交 ${profile.submissionNumber}`);
      return profile;
    } catch (error) {
      if (error && error.kind === "auth") {
        this.profile = null;
        this.identityError = "请先登录 XMUOJ 账号";
      } else {
        this.identityError = `同步个人资料失败：${error.message || error}`;
      }
      this.postError("overview", error);
      return this.profile;
    }
  }

  async _fillSolvedFromSubmissions(username) {
    try {
      const result = await this.api().getAllSolvedSubmissions(username);
      for (const displayId of result.solvedSet) {
        this.solvedSet.add(displayId);
      }
    } catch (error) {
      this.log(`补拉 AC 提交失败：${error.message || error}`);
    }
  }

  async loadCatalog(options = {}) {
    if (this.catalogPromise) {
      return this.catalogPromise;
    }
    const cache = await this._readCatalogCache();
    const now = Date.now();
    if (cache && !this.rawProblems.length) {
      this.rawProblems = cache.problems.map((problem) =>
        normalizeProblem(Object.assign({}, problem, { _id: problem.displayId }))
      );
      this.catalogMeta = {
        source: "cache",
        fetchedAt: Number(cache.fetchedAt) || 0,
        error: "",
        total: Number(cache.total) || this.rawProblems.length,
        stale: now - (Number(cache.fetchedAt) || 0) > this.catalogTtlMs
      };
      this._applyStatuses();
      this.postSnapshot("problems", this._problemsSlice(), { source: "cache" });
      this.postSnapshot("overview", this._overviewSlice(), { source: "cache" });
    }
    const fresh = this.rawProblems.length > 0 && now - this.catalogMeta.fetchedAt < this.catalogTtlMs;
    if (fresh && !options.force) {
      return this.rawProblems;
    }
    if (this.rawProblems.length) {
      this.postLoading("problems");
    }
    this.catalogPromise = this._fetchCatalog().finally(() => {
      this.catalogPromise = null;
    });
    return this.catalogPromise;
  }

  async _fetchCatalog() {
    const api = this.api();
    if (!api) {
      return this.rawProblems;
    }
    try {
      const result = await api.getAllProblems({ pageSize: 200, max: 5000 });
      this.rawProblems = result.problems.map((problem) =>
        normalizeProblem(Object.assign({}, problem, { _id: problem.displayId }))
      );
      this.catalogMeta = {
        source: "server",
        fetchedAt: Date.now(),
        error: "",
        total: result.total || this.rawProblems.length,
        stale: false
      };
      this.sliceErrors.delete("problems");
      this._applyStatuses();
      await this._writeCatalogCache();
      this.postSnapshot("problems", this._problemsSlice(), { source: "server" });
      this.postSnapshot("overview", this._overviewSlice(), { source: "server" });
      this.log(`题目目录已同步：${this.rawProblems.length} 题`);
      return this.rawProblems;
    } catch (error) {
      this.catalogMeta.error = error && error.message ? error.message : String(error);
      this.catalogMeta.stale = this.rawProblems.length > 0;
      this.postError("problems", error);
      if (!this.rawProblems.length) {
        await this._fetchCatalogFallback(error);
      }
      this._applyStatuses();
      return this.rawProblems;
    }
  }

  /** 站点网页 API 不可用时，退回插件专用接口（只取第一页，够本地队列使用）。 */
  async _fetchCatalogFallback(originalError) {
    const client = this.actions.getClient ? this.actions.getClient() : null;
    if (!client || typeof client.getProblemset !== "function") {
      return;
    }
    try {
      const data = await client.getProblemset({ limit: 100, offset: 0 });
      const results = Array.isArray(data) ? data : data && Array.isArray(data.results) ? data.results : [];
      if (!results.length) {
        return;
      }
      this.rawProblems = results.map((problem) => normalizeProblem(problem));
      this.catalogMeta = {
        source: "fallback",
        fetchedAt: Date.now(),
        error: originalError && originalError.message ? originalError.message : "",
        total: results.length,
        stale: true
      };
      this.log(`已退回插件题库接口：${results.length} 题`);
    } catch (error) {
      this.log(`插件题库接口也不可用：${error.message || error}`);
    }
  }

  async loadRank(rule = "acm", force = false) {
    const key = rule === "oi" ? "oi" : "acm";
    const state = this.rankState[key];
    if (!force && state.index && Date.now() - state.fetchedAt < RANK_TTL_MS) {
      return state.index;
    }
    if (state.loading) {
      return state.index;
    }
    const api = this.api();
    if (!api) {
      return null;
    }
    state.loading = true;
    this.postLoading("ranking");
    this.postSnapshot("ranking", this._rankView(key));
    try {
      const result = await api.getAllRank({ rule: key, pageSize: 2000, maxPages: 10 });
      state.index = ranking.buildRankIndex(result.pages, {
        rule: key,
        truncated: result.truncated
      });
      state.fetchedAt = Date.now();
      state.error = "";
      this.sliceErrors.delete("ranking");
      this.postSnapshot("ranking", this._rankView(key));
      this.postSnapshot("overview", this._overviewSlice());
      return state.index;
    } catch (error) {
      state.error = error.message || String(error);
      this.postError("ranking", error);
      return state.index;
    } finally {
      state.loading = false;
      this.postSnapshot("ranking", this._rankView(key));
      this.postSnapshot("overview", this._overviewSlice());
    }
  }

  async loadOverviewExtras(force = false) {
    const api = this.api();
    if (!api) {
      return;
    }
    const now = Date.now();
    const tasks = [];
    if (this.me && (force || now - this.recentSubmissionsFetchedAt > PROFILE_TTL_MS)) {
      tasks.push(
        api
          .getSubmissions({ username: this.me, limit: 20 })
          .then((page) => {
            this.recentSubmissions = page.results;
            this.recentSubmissionsFetchedAt = Date.now();
            this.sliceErrors.delete("overview");
          })
          .catch((error) => {
            this.sliceErrors.set("overview", error.message || String(error));
          })
      );
    }
    if (this.me && (force || now - this.myContestsFetchedAt > PROFILE_TTL_MS)) {
      tasks.push(
        api
          .getUserContests(this.me, { limit: 5 })
          .then((page) => {
            this.myContests = page.results;
            this.myContestsFetchedAt = Date.now();
          })
          .catch((error) => {
            this.log(`拉取实验战绩失败：${error.message || error}`);
          })
      );
    }
    tasks.push(this.loadFollowDetails({ force }));
    await Promise.allSettled(tasks);
  }

  async loadFollowDetails(options = {}) {
    const api = this.api();
    if (!api) {
      return;
    }
    const now = Date.now();
    await Promise.allSettled(
      this.follows.slice(0, 20).map(async (username) => {
        const key = username.toLowerCase();
        const cached = this.followDetails.get(key);
        if (!options.force && cached && now - cached.fetchedAt < FOLLOW_TTL_MS) {
          return;
        }
        const detail = { fetchedAt: now, profile: null, recentSubmission: null, contests: [], avatar: "", error: "", loading: false };
        this.followDetails.set(key, Object.assign({}, cached || {}, detail, { loading: true }));
        this.postSnapshot("following", {
          users: this.follows.map((name) => this._followCard(name))
        });
        try {
          const [page, contests] = await Promise.all([
            api.getSubmissions({ username, limit: 1 }).catch(() => null),
            api.getUserContests(username, { limit: 3 }).catch(() => null)
          ]);
          detail.recentSubmission = page && page.results.length ? page.results[0] : null;
          detail.contests = contests ? contests.results : [];
          detail.avatar = detail.recentSubmission && detail.recentSubmission.avatar
            ? detail.recentSubmission.avatar
            : "";
          const rankRow = this.rankState.acm.index ? ranking.locateRank(this.rankState.acm.index, username) : null;
          if (!rankRow || rankRow.status !== "ranked") {
            try {
              detail.profile = await api.getProfile(username);
            } catch (_error) {
              detail.profile = null;
            }
          }
        } catch (error) {
          detail.error = error.message || String(error);
        }
        detail.loading = false;
        this.followDetails.set(key, detail);
        this.postSnapshot("following", {
          users: this.follows.map((name) => this._followCard(name))
        });
      })
    );
  }

  async loadFollowProfile(username) {
    const target = String(username || "").trim();
    if (!target) {
      return;
    }
    const api = this.api();
    if (!api) {
      return;
    }
    this.postLoading("followProfile");
    const rankRow = this.rankState.acm.index ? ranking.locateRank(this.rankState.acm.index, target) : null;
    let profile = null;
    let recent = [];
    let contests = [];
    let error = "";
    try {
      const [profileResult, page, contestPage] = await Promise.allSettled([
        api.getProfile(target),
        api.getSubmissions({ username: target, limit: 10 }),
        api.getUserContests(target, { limit: 5 })
      ]);
      if (profileResult.status === "fulfilled") {
        profile = profileResult.value;
      }
      if (page.status === "fulfilled") {
        recent = page.value.results;
      }
      if (contestPage.status === "fulfilled") {
        contests = contestPage.value.results;
      }
      const failure = [profileResult, page, contestPage].find((item) => item.status === "rejected");
      if (failure) {
        error = failure.reason && failure.reason.message ? failure.reason.message : "部分数据加载失败";
      }
    } catch (loadError) {
      error = loadError.message || String(loadError);
      this.postError("followProfile", loadError);
    }
    const row = rankRow && rankRow.row ? rankRow.row : null;
    this.postSnapshot(
      "followProfile",
      {
        username: target,
        found: Boolean(profile || row),
        avatar: (profile && profile.avatar) || (row && row.avatar) || "",
        school: (profile && profile.school) || (row && row.school) || "",
        acceptedNumber: profile ? profile.acceptedNumber : row ? row.acceptedNumber : null,
        submissionNumber: profile ? profile.submissionNumber : row ? row.submissionNumber : null,
        totalScore: profile ? profile.totalScore : row ? row.totalScore : null,
        rank: rankRow && rankRow.rank ? rankRow.rank : null,
        position: row ? row.position : null,
        followed: this.follows.some((name) => name.toLowerCase() === target.toLowerCase()),
        recentSubmissions: recent,
        contests,
        error
      },
      { source: error ? "mixed" : "server" }
    );
  }

  // ----------------------------------------------------------------- queue

  async _persistQueue() {
    if (this.actions.persistQueue) {
      await this.actions.persistQueue();
    }
    if (this.actions.refreshTree) {
      this.actions.refreshTree();
    }
    this.postQueue();
    this.postSnapshot("problems", this._problemsSlice());
  }

  async addToQueue(identifier) {
    const problem = this.resolveProblem(identifier);
    if (!problem) {
      this.postToast("warn", "找不到这道题");
      return;
    }
    const queue = queueLib.upsertSelection(
      this.state.problemsetSelections || [],
      {
        id: problem.id,
        display_id: problem.displayId,
        title: problem.title,
        difficulty: problem.difficulty,
        languages: []
      },
      this.baseUrl
    );
    this.state.problemsetSelections = queue;
    await this._persistQueue();
    this.postToast("info", `已加入队列：${problem.displayId} ${problem.title}`);
  }

  async removeFromQueue(identifier) {
    const item = this.resolveProblem(identifier) || identifier;
    this.state.problemsetSelections = queueLib.removeSelection(
      this.state.problemsetSelections || [],
      { id: item && item.id !== undefined ? item.id : identifier },
      this.baseUrl
    );
    await this._persistQueue();
  }

  async clearQueue() {
    this.state.problemsetSelections = [];
    await this._persistQueue();
  }

  async queueNext() {
    const next = queueLib.nextSelection(
      this.state.problemsetSelections || [],
      this._readQueueCursor(),
      this.baseUrl
    );
    if (!next) {
      this.postToast("warn", "队列里还没有题目");
      return;
    }
    const problem = this.resolveProblem(next.id) || {
      id: next.id,
      displayId: next.display_id,
      title: next.title
    };
    await this.actions.startProblem(problem);
  }

  async queueToTop(identifier) {
    const problem = this.resolveProblem(identifier);
    if (!problem) {
      return;
    }
    this.state.problemsetSelections = queueLib.moveSelectionToTop(
      this.state.problemsetSelections || [],
      { id: problem.id, display_id: problem.displayId, title: problem.title },
      this.baseUrl
    );
    await this._persistQueue();
  }

  // ----------------------------------------------------- submission hook

  /**
   * 提交流程落库后调用：只更新公共题库的已 AC 状态。
   * 题库内竞速由 ContestRaceWorkbench 单独处理。
   */
  noteMySubmission(payload = {}) {
    const displayId = String(payload.displayId || "");
    const accepted = Boolean(payload.accepted);
    const numericId = payload.problemId;
    if (accepted) {
      if (numericId !== undefined && numericId !== null) {
        this.solvedSet.add(String(numericId));
        this.attemptedSet.delete(String(numericId));
      }
      if (displayId) {
        this.solvedSet.add(displayId);
        this.attemptedSet.delete(displayId);
      }
      this._applyStatuses();
      this.postSnapshot("problems", this._problemsSlice());
      this.postSnapshot("overview", this._overviewSlice());
    }
  }

  // --------------------------------------------------------------- messages

  async handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    const type = String(message.type || "");
    const requestId = message.requestId;
    switch (type) {
      case "ready":
        this.postAll();
        await this.refreshAll({ force: false });
        await this.loadCapsules();
        return;
      case "refresh": {
        const slice = String(message.slice || "all");
        this.postLoading(slice, requestId);
        if (slice === "all") {
          await this.refreshAll({ force: Boolean(message.force) });
          await this.loadCapsules();
        } else if (slice === "problems") {
          await this.loadCatalog({ force: true });
          this.postSnapshot("problems", this._problemsSlice(), {}, requestId);
        } else if (slice === "ranking") {
          await this.loadRank(this.ui.rankRule, true);
        } else if (slice === "following") {
          await this.loadFollowDetails({ force: true });
        } else if (slice === "overview") {
          await Promise.allSettled([
            this.loadIdentity(true),
            this.loadRank(this.ui.rankRule, false)
          ]);
          await this.loadOverviewExtras(true);
          this.postSnapshot("overview", this._overviewSlice(), {}, requestId);
        }
        return;
      }
      case "setTab":
        this.ui.tab = TABS.includes(message.tab) ? message.tab : "overview";
        await this._saveUi();
        return;
      case "persistUi": {
        const incoming = message.ui && typeof message.ui === "object" ? message.ui : message;
        const merged = normalizeUi(
          Object.assign({}, this.ui, incoming, {
            filters: Object.assign({}, this.ui.filters, incoming.filters || {})
          })
        );
        const ruleChanged = merged.rankRule !== this.ui.rankRule;
        this.ui = merged;
        await this._saveUi();
        this.postSnapshot("problems", this._problemsSlice());
        if (ruleChanged) {
          await this.loadRank(this.ui.rankRule, false);
        }
        return;
      }
      case "setRankRule":
        this.ui.rankRule = message.rule === "oi" ? "oi" : "acm";
        await this._saveUi();
        this.postSnapshot("ranking", this._rankView(this.ui.rankRule));
        this.postSnapshot("overview", this._overviewSlice());
        await this.loadRank(this.ui.rankRule, false);
        return;
      case "openProblem": {
        const problem = this.resolveProblem(message.id);
        if (problem) {
          await this.actions.openProblem(problem);
        }
        return;
      }
      case "startProblem": {
        const problem = this.resolveProblem(message.id);
        if (problem) {
          await this.actions.startProblem(problem);
        }
        return;
      }
      case "openOnline": {
        const problem = this.resolveProblem(message.id);
        if (problem) {
          await this.actions.openOnline(problem);
        }
        return;
      }
      case "addQueue":
        await this.addToQueue(message.id);
        return;
      case "removeQueue":
        await this.removeFromQueue(message.id);
        return;
      case "clearQueue":
        await this.clearQueue();
        return;
      case "queueNext":
        await this.queueNext();
        return;
      case "queueToTop":
        await this.queueToTop(message.id);
        return;
      case "follow": {
        const username = String(message.username || "").trim();
        if (!username) {
          return;
        }
        if (!this.follows.some((name) => name.toLowerCase() === username.toLowerCase())) {
          this.follows.push(username);
          this.follows = this.follows.slice(0, 50);
          await this._saveFollows();
          this.postSnapshot("following", {
            users: this.follows.map((name) => this._followCard(name))
          });
          this.postSnapshot("overview", this._overviewSlice());
          this.loadFollowDetails({ force: true }).catch(() => null);
        }
        return;
      }
      case "unfollow": {
        const username = String(message.username || "").trim().toLowerCase();
        this.follows = this.follows.filter((name) => name.toLowerCase() !== username);
        this.followDetails.delete(username);
        await this._saveFollows();
        this.postSnapshot("following", {
          users: this.follows.map((name) => this._followCard(name))
        });
        this.postSnapshot("overview", this._overviewSlice());
        return;
      }
      case "openProfile":
        await this.loadFollowProfile(message.username);
        return;
      case "loadProblemBoard":
        await this.loadProblemBoard(message.problemId || message.id, {
          force: Boolean(message.force)
        });
        return;
      case "login":
        if (this.actions.login) {
          await this.actions.login();
        }
        return;
      case "visibility":
        this.visible = Boolean(message.visible);
        if (this.visible) {
          this.postAll();
        }
        return;
      default:
        return;
    }
  }
}

module.exports = {
  ProblemsetWorkbench,
  DEFAULT_UI,
  TABS,
  normalizeUi
};
