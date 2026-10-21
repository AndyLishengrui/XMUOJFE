/**
 * 题库竞速面板的扩展侧控制器。
 *
 * 竞速只在“题库”（教材配套题库）中开放：实验/考试可能是正式比赛，
 * 不能提供竞速，避免作弊。面板本身不直接发网络请求，提交记录一律通过
 * /api/contest_submissions 读取（公开的 /api/submissions 不含实验提交）。
 */
"use strict";

const vscode = require("vscode");
const path = require("path");

const raceLib = require("./problemsetRace");
const insights = require("./problemsetInsights");
const {
  createSiteApi,
  normalizeProblem,
  isQuestionBankContest,
  isExamContest
} = require("./siteApi");

const RECORDS_KEY = "xmuoj.contestRaces.v1";
const MAX_HISTORY = 20;
const MAX_EVENTS = 200;
const OPPONENT_PAGES = 2;
const OPPONENT_TTL_MS = 3 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function statusFromRaw(raw) {
  const value = raw && raw.my_status !== undefined ? raw.my_status : raw && raw.myStatus;
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "string" && /accepted|^ac$/i.test(value.trim())) {
    return "solved";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "";
  }
  return number === 0 ? "solved" : "attempted";
}

function contestSnapshot(contest) {
  if (!contest) {
    return null;
  }
  return {
    id: contest.id,
    title: String(contest.title || contest.name || `题库 ${contest.id}`),
    status: contest.status || null,
    startTime: contest.start_time || contest.startTime || null,
    endTime: contest.end_time || contest.endTime || null,
    ruleType: String(contest.rule_type || contest.ruleType || ""),
    isQuestionBank: isQuestionBankContest(contest),
    isExam: isExamContest(contest)
  };
}

function historyEntry(race, me) {
  const summary = raceLib.raceSummary(race);
  let result = "none";
  if (race.winner && me) {
    result = race.winner === me ? "win" : "loss";
  } else if (race.tie) {
    result = "tie";
  }
  return {
    id: race.id,
    mode: "live",
    contest: race.contest || null,
    problem: race.problem,
    opponents: (race.participants || [])
      .map((item) => item.username)
      .filter((username) => username && username !== me),
    startedAt: race.startAt,
    finishedAt: race.finishedAt || nowIso(),
    winner: race.winner || null,
    result,
    participants: summary.participants,
    submissions: summary.submissions
  };
}

class ContestRaceWorkbench {
  constructor(options) {
    this.context = options.context;
    this.state = options.state || {};
    this.actions = options.actions || {};
    this.outputChannel = options.outputChannel || null;

    const config = vscode.workspace.getConfiguration("xmuoj");
    this.pollIntervalMs =
      Math.max(5, Number(config.get("race.pollIntervalSeconds", 10)) || 10) * 1000;

    this.panel = null;
    this.visible = false;
    this.disposed = false;

    this.entry = null;
    this.contest = null;
    this.baseUrl = "";
    this.scopeKey = "";
    this.problems = [];
    this.problemIndex = new Map();
    this.myStatuses = new Map();
    this.warning = "";

    this.records = this._readRecords();
    this._sweepRecords();
    this.race = null;
    this.history = [];
    this.raceBusy = false;

    this.opponent = {
      username: "",
      data: null,
      loading: false,
      error: "",
      fetchedAt: 0,
      truncated: false
    };
    this.opponentSeq = 0;

    this.raceTimer = null;
    this.racePolling = false;
  }

  // ---------------------------------------------------------------- helpers

  get me() {
    return this.actions.getUsername ? String(this.actions.getUsername() || "") : "";
  }

  api() {
    const client = this.actions.getClient ? this.actions.getClient() : null;
    return client ? createSiteApi(client) : null;
  }

  log(message) {
    if (this.outputChannel) {
      this.outputChannel.appendLine(`[题库竞速] ${message}`);
    }
  }

  _readRecords() {
    const raw = this.context.globalState.get(RECORDS_KEY, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  _writeRecords() {
    this.context.globalState.update(RECORDS_KEY, this.records).catch(() => null);
  }

  _scopeKeyFor(contest, baseUrl) {
    if (!contest) {
      return "";
    }
    return raceLib.fnv1a(`${String(baseUrl || "").replace(/\/+$/, "")}::${contest.id}`);
  }

  /**
   * 启动时整理本地竞速记录：
   * - 影子竞速已下线，清空所有影子历史与残留的活跃影子竞速；
   * - 已超时/已结束的活跃竞速转入历史；
   * - 防御性地保证全局最多只剩一场活跃竞速。
   */
  _sweepRecords() {
    let changed = false;
    const now = nowIso();
    const actives = [];
    for (const [scopeKey, scope] of Object.entries(this.records)) {
      if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
        delete this.records[scopeKey];
        changed = true;
        continue;
      }
      const history = Array.isArray(scope.history) ? scope.history : [];
      const kept = history.filter((entry) => entry && entry.mode !== "shadow");
      if (kept.length !== history.length || !Array.isArray(scope.history)) {
        scope.history = kept.slice(0, MAX_HISTORY);
        changed = true;
      }
      const active = scope.active || null;
      if (active && active.mode === "shadow") {
        scope.active = null;
        changed = true;
        continue;
      }
      if (!active) {
        if (scope.active) {
          scope.active = null;
          changed = true;
        }
        continue;
      }
      const evaluation = raceLib.evaluateRace(active, now);
      if (raceLib.isTerminal(active) || evaluation.status === "finished") {
        const finished = Object.assign({}, active, {
          status: raceLib.isTerminal(active) ? active.status : "finished",
          winner: evaluation.status === "finished" ? evaluation.winner || null : active.winner || null,
          tie: evaluation.status === "finished" ? Boolean(evaluation.tie) : Boolean(active.tie),
          noWinner: evaluation.status === "finished" ? Boolean(evaluation.noWinner) : Boolean(active.noWinner),
          finishedAt: active.finishedAt || now
        });
        scope.active = null;
        if (!scope.history.some((entry) => entry.id === finished.id)) {
          scope.history = [historyEntry(finished, this.me)]
            .concat(scope.history)
            .slice(0, MAX_HISTORY);
        }
        changed = true;
      } else {
        actives.push({ scopeKey, race: active });
      }
    }
    if (actives.length > 1) {
      actives.sort(
        (left, right) =>
          Date.parse(right.race.updatedAt || right.race.createdAt || 0) -
          Date.parse(left.race.updatedAt || left.race.createdAt || 0)
      );
      for (const extra of actives.slice(1)) {
        const scope = this.records[extra.scopeKey];
        if (!scope) {
          continue;
        }
        const cancelled = Object.assign({}, extra.race, {
          status: "cancelled",
          finishedAt: now
        });
        scope.active = null;
        if (!scope.history.some((entry) => entry.id === cancelled.id)) {
          scope.history = [historyEntry(cancelled, this.me)]
            .concat(scope.history)
            .slice(0, MAX_HISTORY);
        }
        changed = true;
      }
    }
    if (changed) {
      this._writeRecords();
    }
  }

  /** 全插件只允许一场竞速：返回当前活跃竞速及其所属题库。 */
  _activeRaceLocation() {
    for (const [scopeKey, scope] of Object.entries(this.records)) {
      if (scope && scope.active && !raceLib.isTerminal(scope.active)) {
        return { scopeKey, race: scope.active };
      }
    }
    return null;
  }

  _activeRaceMessage(location) {
    const title =
      location && location.race && location.race.contest && location.race.contest.title;
    return title
      ? `题库「${title}」还有一场竞速未结束，请先回到该题库结束竞速。`
      : "已有一场竞速进行中，请先结束当前竞速。";
  }

  _scopeRecords() {
    const scoped = this.records[this.scopeKey];
    return scoped && typeof scoped === "object" ? scoped : {};
  }

  _loadScope() {
    const scoped = this._scopeRecords();
    const active = scoped.active || null;
    const sameContest = Boolean(
      active &&
        active.contest &&
        String(active.contest.id) === String(this.contest ? this.contest.id : "")
    );
    this.race = sameContest && !raceLib.isTerminal(active) ? active : null;
    this.history = Array.isArray(scoped.history) ? scoped.history.slice(0, MAX_HISTORY) : [];
  }

  _persistScope() {
    if (!this.scopeKey) {
      return;
    }
    this.records[this.scopeKey] = {
      active: this.race || null,
      history: this.history.slice(0, MAX_HISTORY)
    };
    this._writeRecords();
  }

  _setRace(race) {
    this.race = race;
    this._persistScope();
    this.postState();
  }

  _canRace() {
    return Boolean(this.contest && isQuestionBankContest(this.contest));
  }

  _applyStatuses(rawProblems) {
    const next = new Map(this.myStatuses);
    for (const raw of rawProblems || []) {
      const problem = normalizeProblem(raw);
      if (!problem || !problem.displayId) {
        continue;
      }
      const status = statusFromRaw(raw);
      if (status) {
        next.set(problem.displayId, status);
      }
    }
    this.myStatuses = next;
  }

  _applyWorkspace(workspace) {
    if (!workspace || !workspace.contest) {
      return;
    }
    this.contest = workspace.contest;
    const baseUrl = String(workspace.baseUrl || this.baseUrl || "");
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
    this.entry = Object.assign({}, this.entry || {}, {
      contest: this.contest,
      problems: workspace.problems || (this.entry && this.entry.problems) || [],
      contestPassword: workspace.contestPassword !== undefined
        ? workspace.contestPassword
        : this.entry && this.entry.contestPassword
    });
    this._setProblems(workspace.problems || []);
    if (this.panel) {
      this.panel.title = `题库竞速 · ${contestSnapshot(this.contest).title}`;
    }
    if (!this._canRace()) {
      this.warning = isExamContest(this.contest)
        ? "该实验是考试，已禁止竞速。"
        : "该实验不是题库，只有题库提供竞速。";
    } else {
      this.warning = "";
    }
  }

  _setProblems(rawProblems) {
    this.problems = [];
    this.problemIndex = new Map();
    for (const raw of rawProblems || []) {
      const problem = normalizeProblem(raw);
      if (!problem || !problem.displayId) {
        continue;
      }
      problem.status = this.myStatuses.get(problem.displayId) || "";
      this.problems.push(problem);
      this.problemIndex.set(problem.displayId, problem);
      if (problem.id !== undefined && problem.id !== null) {
        this.problemIndex.set(String(problem.id), problem);
      }
    }
    this._applyStatuses(rawProblems);
    for (const problem of this.problems) {
      problem.status = this.myStatuses.get(problem.displayId) || "";
    }
  }

  resolveProblem(id) {
    if (id === undefined || id === null || id === "") {
      return null;
    }
    return this.problemIndex.get(String(id)) || null;
  }

  // ------------------------------------------------------------------ panel

  async open(entry) {
    if (this.disposed) {
      return;
    }
    const contest = entry && entry.contest;
    if (!contest || contest.id === undefined || contest.id === null) {
      vscode.window.showWarningMessage("请先从「我的题库」选择一个题库。");
      return;
    }
    if (!isQuestionBankContest(contest)) {
      vscode.window.showWarningMessage(
        isExamContest(contest)
          ? "这是考试实验，不能启用竞速。"
          : "只有题库提供竞速；实验和考试不提供。"
      );
      return;
    }

    const requestedBaseUrl = String(
      entry.baseUrl || (this.actions.getBaseUrl ? this.actions.getBaseUrl() : "") || ""
    );
    const targetScopeKey = this._scopeKeyFor(contest, requestedBaseUrl);
    const active = this._activeRaceLocation();
    if (active && active.scopeKey !== targetScopeKey) {
      vscode.window.showWarningMessage(this._activeRaceMessage(active));
      return;
    }

    if (this.panel) {
      const same =
        this.contest &&
        String(this.contest.id) === String(contest.id) &&
        this.baseUrl === String(entry.baseUrl || this.baseUrl || "");
      this.panel.reveal(vscode.ViewColumn.Two, false);
      this.visible = true;
      if (same) {
        this.postState();
        return;
      }
    }

    this.entry = entry;
    this.contest = contest;
    this.baseUrl = requestedBaseUrl;
    this.scopeKey = targetScopeKey;
    this.myStatuses = new Map();
    this.opponent = { username: "", data: null, loading: false, error: "", fetchedAt: 0, truncated: false };
    this.warning = "";
    this._setProblems(entry.problems || []);
    this._loadScope();

    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel(
        "xmuojContestRace",
        `题库竞速 · ${contestSnapshot(contest).title}`,
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
        }
      );
      this.panel = panel;
      this.state.contestRacePanel = panel;
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
            this.postState();
            this.scheduleRacePoll(0);
          } else {
            this._clearRaceTimer();
          }
        });
      }
      panel.onDidDispose(() => {
        if (this.panel === panel) {
          this.panel = null;
        }
        if (this.state.contestRacePanel === panel) {
          this.state.contestRacePanel = null;
        }
        this.visible = false;
        this._clearRaceTimer();
      });
    } else {
      this.panel.title = `题库竞速 · ${contestSnapshot(contest).title}`;
      this.panel.reveal(vscode.ViewColumn.Two, false);
      this.panel.webview.html = this._html(this.panel.webview);
    }

    this.visible = true;
    this.postState();
    this.scheduleRacePoll(500);
  }

  _html(webview) {
    const nonce = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 62)
      )
    ).join("");
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const baseStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "problemset", "styles.css")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "contestrace", "styles.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaRoot, "contestrace", "app.js")
    );
    let html = "";
    try {
      const file = path.join(this.context.extensionPath, "media", "contestrace", "index.html");
      html = require("fs").readFileSync(file, "utf8");
    } catch (error) {
      this.log(`读取题库竞速页面失败：${error.message}`);
      html = "<!doctype html><html><body>题库竞速页面缺失，请重新安装插件。</body></html>";
    }
    return html
      .replace(/{{cspSource}}/g, webview.cspSource)
      .replace(/{{nonce}}/g, nonce)
      .replace(/{{baseStyleUri}}/g, String(baseStyleUri))
      .replace(/{{styleUri}}/g, String(styleUri))
      .replace(/{{scriptUri}}/g, String(scriptUri));
  }

  dispose() {
    this.disposed = true;
    this._clearRaceTimer();
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

  // -------------------------------------------------------------- snapshots

  _opponentProblemMap() {
    const map = new Map();
    const data = this.opponent.data;
    if (!data) {
      return map;
    }
    for (const problem of data.problems || []) {
      map.set(problem.displayId, problem);
    }
    return map;
  }

  _problemViews() {
    const opponentMap = this._opponentProblemMap();
    return this.problems.map((problem) => {
      const opponent = opponentMap.get(problem.displayId);
      return {
        id: problem.id,
        displayId: problem.displayId,
        title: problem.title,
        difficulty: problem.difficulty,
        status: this.myStatuses.get(problem.displayId) || "todo",
        opponent: opponent
          ? {
              accepted: Boolean(opponent.accepted),
              attempts: opponent.attempts,
              latestAt: opponent.latestAt,
              latestResultKey: opponent.latestResultKey
            }
          : null
      };
    });
  }

  _stats() {
    const solved = this.problems.filter(
      (problem) => this.myStatuses.get(problem.displayId) === "solved"
    ).length;
    const attempted = this.problems.filter(
      (problem) => this.myStatuses.get(problem.displayId) === "attempted"
    ).length;
    return {
      total: this.problems.length,
      solved,
      attempted,
      todo: Math.max(0, this.problems.length - solved - attempted)
    };
  }

  _opponentView() {
    const data = this.opponent.data;
    const problems = data
      ? data.problems
          .filter((item) => this.problemIndex.has(item.displayId))
          .map((item) => {
            const problem = this.problemIndex.get(item.displayId);
            return Object.assign({}, item, {
              title: problem ? problem.title : item.title,
              difficulty: problem ? problem.difficulty : ""
            });
          })
      : [];
    return {
      username: this.opponent.username,
      loading: Boolean(this.opponent.loading),
      error: this.opponent.error || "",
      fetchedAt: this.opponent.fetchedAt || 0,
      truncated: Boolean(this.opponent.truncated),
      submissionCount: data ? data.submissionCount : 0,
      solvedCount: data ? data.solvedCount : 0,
      attemptedOnlyCount: data ? data.attemptedOnlyCount : 0,
      problems
    };
  }

  _raceView() {
    const race = this.race;
    if (!race) {
      return { active: null };
    }
    return {
      active: {
        id: race.id,
        mode: race.mode,
        problem: race.problem,
        contest: race.contest || null,
        host: race.host,
        status: race.status,
        startAt: race.startAt,
        deadlineAt: race.deadlineAt,
        winner: race.winner || null,
        tie: Boolean(race.tie),
        noWinner: Boolean(race.noWinner),
        token: raceLib.raceToToken(race),
        participants: (race.participants || []).map((participant) => ({
          username: participant.username,
          status: participant.status,
          acceptedAt: participant.acceptedAt,
          submissions: (participant.submissions || []).length,
          isMe: participant.username === this.me
        })),
        events: (race.events || []).slice(-MAX_EVENTS).map((event) => ({
          username: event.username,
          resultKey: event.resultKey,
          createdAt: event.createdAt
        })),
        lastPollError: race.lastPollError || "",
        pollFailures: race.pollFailures || 0
      }
    };
  }

  _view() {
    return {
      contest: contestSnapshot(this.contest),
      canRace: this._canRace(),
      me: this.me,
      loggedIn: Boolean(this.me),
      problems: this._problemViews(),
      stats: this._stats(),
      opponent: this._opponentView(),
      race: this._raceView(),
      history: this.history.slice(0, MAX_HISTORY),
      pollIntervalSeconds: Math.round(this.pollIntervalMs / 1000),
      warning: this.warning
    };
  }

  postState() {
    this.post({ type: "state", data: this._view() });
  }

  // --------------------------------------------------------------- opponent

  async loadOpponent(username, { force = false } = {}) {
    const name = String(username || "").trim();
    if (!name) {
      this.opponent = { username: "", data: null, loading: false, error: "", fetchedAt: 0, truncated: false };
      this.postState();
      return;
    }
    if (name === this.me) {
      this.postToast("warn", "对手需要是另一个用户名");
      return;
    }
    const same = this.opponent.username.toLowerCase() === name.toLowerCase();
    if (
      !force &&
      same &&
      this.opponent.data &&
      Date.now() - this.opponent.fetchedAt < OPPONENT_TTL_MS
    ) {
      this.postState();
      return;
    }
    const api = this.api();
    if (!api) {
      return;
    }
    const seq = ++this.opponentSeq;
    this.opponent = {
      username: name,
      data: same ? this.opponent.data : null,
      loading: true,
      error: "",
      fetchedAt: this.opponent.fetchedAt,
      truncated: false
    };
    this.postState();
    try {
      const page = await api.getContestUserSubmissions(this.contest.id, name, {
        pageSize: 250,
        maxPages: OPPONENT_PAGES
      });
      if (seq !== this.opponentSeq) {
        return;
      }
      const aggregated = insights.aggregateUserHistory(page.results);
      this.opponent = {
        username: name,
        data: aggregated,
        loading: false,
        error: "",
        fetchedAt: Date.now(),
        truncated: Boolean(page.truncated)
      };
      if (!page.results.length) {
        this.postToast("info", `${name} 在这个题库里还没有提交记录`);
      }
    } catch (error) {
      if (seq !== this.opponentSeq) {
        return;
      }
      this.opponent = {
        username: name,
        data: null,
        loading: false,
        error: error && error.message ? error.message : "读取对手提交失败",
        fetchedAt: 0,
        truncated: false
      };
      this.postToast("warn", this.opponent.error);
    }
    this.postState();
  }

  // ------------------------------------------------------------------ races

  _clearRaceTimer() {
    if (this.raceTimer) {
      clearTimeout(this.raceTimer);
      this.raceTimer = null;
    }
  }

  _ensureRaceAllowed() {
    if (!this._canRace()) {
      this.postToast("warn", "只有题库可以竞速，实验和考试已禁用。");
      return false;
    }
    return true;
  }

  async startRace(input = {}) {
    if (this.raceBusy) {
      this.postToast("warn", "正在创建竞速，请稍候…");
      return;
    }
    if (!this._ensureRaceAllowed()) {
      return;
    }
    const active = this._activeRaceLocation();
    if (active) {
      this.postToast("warn", this._activeRaceMessage(active));
      return;
    }
    const me = this.me;
    if (!me) {
      this.postToast("warn", "请先登录后再发起竞速");
      return;
    }
    const problem = this.resolveProblem(input.problemId || input.displayId);
    if (!problem) {
      this.postToast("warn", "请先选择本题库中的一道题");
      return;
    }
    const durationSec = Math.min(7200, Math.max(60, Number(input.durationSec) || 1800));
    const opponent = String(input.opponent || "").trim();
    if (opponent && opponent.toLowerCase() === me.toLowerCase()) {
      this.postToast("warn", "对手需要是另一个用户名");
      return;
    }

    this.raceBusy = true;
    try {
      const now = new Date();
      const contest = {
        id: this.contest.id,
        title: contestSnapshot(this.contest).title,
        isQuestionBank: true
      };
      const participants = opponent ? [me, opponent] : [me];
      const startAt = new Date(now.getTime() + 15000).toISOString();
      const deadlineAt = new Date(now.getTime() + 15000 + durationSec * 1000).toISOString();
      const race = raceLib.createRaceRecord({
        contest,
        problem: { id: problem.id, displayId: problem.displayId, title: problem.title },
        host: me,
        participants,
        startAt,
        deadlineAt,
        now: now.toISOString()
      });
      this._setRace(race);
      const token = raceLib.raceToToken(race);
      await vscode.env.clipboard.writeText(token).catch(() => null);
      this.postToast(
        "info",
        "实时竞速已创建（15 秒后开始）。口令已复制，发给对手后让其在题库面板粘贴加入。"
      );
      this.scheduleRacePoll(1000);
    } finally {
      this.raceBusy = false;
    }
  }

  async joinRace(token) {
    if (!this._ensureRaceAllowed()) {
      return;
    }
    const decoded = raceLib.raceFromToken(token);
    if (!decoded.ok) {
      this.postToast("error", decoded.error);
      return;
    }
    const me = this.me;
    if (!me) {
      this.postToast("warn", "请先登录再加入竞速");
      return;
    }
    const incoming = decoded.race;
    if (!incoming.contest || String(incoming.contest.id) !== String(this.contest.id)) {
      this.postToast(
        "error",
        "这个口令属于另一个题库；请先加载对应的题库再粘贴口令"
      );
      return;
    }
    if (incoming.contest.isQuestionBank === false) {
      this.postToast("error", "该口令不是题库竞速，已拒绝");
      return;
    }
    const problem = this.resolveProblem(incoming.problem.displayId);
    if (!problem) {
      this.postToast("error", "口令中的题目不在当前题库里");
      return;
    }
    incoming.problem = {
      id: problem.id,
      displayId: problem.displayId,
      title: problem.title
    };
    if (Date.parse(incoming.deadlineAt) <= Date.now()) {
      this.postToast("error", "这场竞速已经结束，无法加入");
      return;
    }
    const active = this._activeRaceLocation();
    if (active) {
      const already =
        active.race.id === incoming.id &&
        (active.race.participants || []).some((item) => item.username === me);
      this.postToast(
        already ? "info" : "warn",
        already ? "你已经在这场竞速中" : this._activeRaceMessage(active)
      );
      return;
    }
    if (!incoming.participants.some((item) => item.username === me)) {
      if (incoming.participants.length >= raceLib.MAX_PARTICIPANTS) {
        this.postToast("error", `竞速最多 ${raceLib.MAX_PARTICIPANTS} 人`);
        return;
      }
      incoming.participants.push({
        username: me,
        status: "waiting",
        submissions: [],
        acceptedAt: null,
        acceptedSubmissionId: null
      });
    }
    incoming.host = incoming.host || me;
    this._setRace(incoming);
    this.postToast("info", "已加入竞速");
    this.scheduleRacePoll(1000);
  }

  async cancelRace() {
    this._clearRaceTimer();
    if (this.race) {
      const cancelled = Object.assign({}, this.race, {
        status: "cancelled",
        finishedAt: nowIso()
      });
      this._pushHistory(cancelled);
    }
    this._setRace(null);
    this.postToast("info", "已结束当前竞速");
  }

  _pushHistory(race) {
    const entry = historyEntry(race, this.me);
    this.history = [entry]
      .concat(this.history.filter((item) => item.id !== entry.id))
      .slice(0, MAX_HISTORY);
    this._persistScope();
  }

  scheduleRacePoll(delayMs) {
    this._clearRaceTimer();
    if (
      !this.race ||
      raceLib.isTerminal(this.race) ||
      this.disposed ||
      !this.visible
    ) {
      return;
    }
    const delay = Math.max(0, Number(delayMs) || this.pollIntervalMs);
    this.raceTimer = setTimeout(() => {
      this.raceTimer = null;
      this.pollRace().catch((error) => {
        this.log(`竞速轮询失败：${error && error.message ? error.message : error}`);
      });
    }, delay);
  }

  async pollRace() {
    if (!this.race || raceLib.isTerminal(this.race) || this.racePolling) {
      return;
    }
    if (!this._canRace()) {
      return;
    }
    const api = this.api();
    if (!api) {
      return;
    }
    this.racePolling = true;
    const race = this.race;
    let nextRace = race;
    let failure = null;
    try {
      const startMs = Date.parse(race.startAt);
      const usernames = (race.participants || [])
        .map((item) => item.username)
        .filter(Boolean);
      for (const username of usernames) {
        try {
          const page = await api.getContestSubmissions({
            contestId: this.contest.id,
            username,
            problemId: race.problem.displayId,
            limit: 50
          });
          if (!this.race || this.race.id !== race.id) {
            return;
          }
          for (const submission of page.results) {
            if (!submission.createdAt) {
              continue;
            }
            // 开始之前的历史提交不参与本场竞速。
            if (Date.parse(submission.createdAt) < startMs) {
              continue;
            }
            nextRace = raceLib.recordSubmission(nextRace, submission, nowIso());
          }
        } catch (error) {
          failure = error;
          if (error && error.kind === "auth") {
            break;
          }
        }
      }
    } finally {
      this.racePolling = false;
    }

    // 竞速在请求期间被取消或被替换时，旧结果必须丢弃。
    if (!this.race || this.race.id !== race.id) {
      return;
    }

    if (failure && failure.kind === "auth") {
      nextRace = Object.assign({}, nextRace, {
        lastPollError: "登录状态失效，竞速已暂停",
        pollFailures: (nextRace.pollFailures || 0) + 1
      });
      this._setRace(nextRace);
      this.postToast("warn", "登录状态失效，竞速已暂停；重新登录后会继续");
      return;
    }

    const me = this.me;
    const evaluation = raceLib.evaluateRace(nextRace, nowIso());

    nextRace = Object.assign({}, nextRace, {
      status: evaluation.status,
      winner: evaluation.winner || null,
      tie: Boolean(evaluation.tie),
      noWinner: Boolean(evaluation.noWinner),
      lastPollError: failure ? failure.message || "网络不稳定" : "",
      pollFailures: failure ? (nextRace.pollFailures || 0) + 1 : 0,
      degraded: failure ? Boolean((nextRace.pollFailures || 0) + 1 >= 3) : false,
      lastPollAt: nowIso()
    });

    if (evaluation.status === "finished") {
      nextRace.finishedAt = nowIso();
      this._pushHistory(nextRace);
      this._setRace(nextRace);
      this.postToast(
        evaluation.noWinner ? "warn" : evaluation.winner === me ? "info" : "warn",
        evaluation.noWinner
          ? "竞速结束：没有人在时限内完成"
          : evaluation.tie
            ? "竞速结束：平局"
            : evaluation.winner === me
              ? "竞速结束：你赢了！"
              : `竞速结束：${evaluation.winner || "对手"} 获胜`
      );
      setTimeout(() => {
        if (this.race && this.race.id === nextRace.id) {
          this._setRace(null);
        }
      }, 10000);
      return;
    }

    this._setRace(nextRace);
    const delay = raceLib.nextPollDelay(
      nextRace.pollFailures || 0,
      failure && failure.kind,
      this.pollIntervalMs
    );
    if (delay.paused) {
      this.postToast(
        "warn",
        failure && failure.kind === "auth"
          ? "竞速轮询已暂停：登录状态失效"
          : "竞速轮询已暂停：连续读取失败，请检查题库提交权限或网络"
      );
      return;
    }
    let nextDelay = delay.delayMs;
    const remaining = Date.parse(nextRace.deadlineAt) - Date.now();
    if (remaining > 0 && remaining < 2 * 60 * 1000) {
      nextDelay = Math.min(nextDelay, 5000);
    }
    this.scheduleRacePoll(nextDelay);
  }

  // --------------------------------------------------------- submission hook

  /** 提交落库后调用；只更新本题库内的状态与活跃竞速。 */
  noteMySubmission(payload = {}) {
    const displayId = String(payload.displayId || "");
    if (!displayId) {
      return;
    }
    if (
      payload.contestId !== undefined &&
      payload.contestId !== null &&
      this.contest &&
      String(payload.contestId) !== String(this.contest.id)
    ) {
      return;
    }
    if (!this.problemIndex.has(displayId)) {
      return;
    }
    const accepted = Boolean(payload.accepted);
    if (accepted) {
      this.myStatuses.set(displayId, "solved");
    } else if (!this.myStatuses.get(displayId)) {
      this.myStatuses.set(displayId, "attempted");
    }
    this.postState();

    const race = this.race;
    if (!race || raceLib.isTerminal(race) || race.problem.displayId !== displayId) {
      return;
    }
    const me = this.me;
    if (!me) {
      return;
    }
    const resultKey =
      payload.resultKey ||
      (accepted ? "AC" : String(payload.resultLabel || "Unknown"));
    const updated = raceLib.recordSubmission(
      race,
      {
        id: payload.submissionId,
        username: me,
        problemDisplayId: displayId,
        resultCode: payload.resultCode,
        resultKey,
        createdAt: payload.createdAt || nowIso()
      },
      nowIso()
    );
    this._setRace(updated);
    this.scheduleRacePoll(1000);
  }

  // --------------------------------------------------------------- messages

  async handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }
    switch (String(message.type || "")) {
      case "ready":
        this.postState();
        if (this.race) {
          this.scheduleRacePoll(0);
        }
        return;
      case "refresh":
        await this.refresh();
        return;
      case "refreshOpponent":
        await this.loadOpponent(message.username, { force: true });
        return;
      case "loadOpponent":
        await this.loadOpponent(message.username, { force: Boolean(message.force) });
        return;
      case "startRace":
        await this.startRace(message);
        return;
      case "joinRace":
        await this.joinRace(message.token);
        return;
      case "cancelRace":
        await this.cancelRace();
        return;
      case "copyRaceToken":
        if (message.token) {
          await vscode.env.clipboard.writeText(String(message.token)).catch(() => null);
          this.postToast("info", "竞速口令已复制");
        }
        return;
      case "openProblem": {
        const problem = this.resolveProblem(message.id);
        if (problem && this.actions.openProblem) {
          await this.actions.openProblem({
            problem: problem.raw || problem,
            contest: this.contest,
            problems: this.problems.map((item) => item.raw || item),
            contestPassword: this.entry ? this.entry.contestPassword : ""
          });
        }
        return;
      }
      case "startProblem": {
        const problem = this.resolveProblem(message.id);
        if (problem && this.actions.startProblem) {
          await this.actions.startProblem({ problem: problem.raw || problem, contest: this.contest });
        }
        return;
      }
      case "openOnline": {
        const problem = this.resolveProblem(message.id);
        if (problem && this.actions.openOnline) {
          await this.actions.openOnline({ problem: problem.raw || problem, contest: this.contest });
        }
        return;
      }
      case "visibility":
        this.visible = Boolean(message.visible);
        if (this.visible) {
          this.scheduleRacePoll(0);
        } else {
          this._clearRaceTimer();
        }
        return;
      default:
        return;
    }
  }

  async refresh() {
    if (!this.actions.refreshContest || !this.entry) {
      this.postToast("warn", "当前无法刷新题库，请重新加载题库");
      return;
    }
    this.postToast("info", "正在刷新题库…");
    try {
      const workspace = await this.actions.refreshContest(this.entry);
      this._applyWorkspace(workspace);
      this.postState();
      this.postToast("info", "题库已刷新");
    } catch (error) {
      this.postToast("error", error && error.message ? error.message : "刷新题库失败");
    }
  }
}

module.exports = {
  ContestRaceWorkbench,
  RECORDS_KEY
};
