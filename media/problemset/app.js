/**
 * XMUOJ 刷题台页面。
 *
 * 页面不做任何网络请求，也不保存权威数据：所有快照来自扩展，所有动作都用
 * postMessage 交给扩展处理。服务端字符串一律用 textContent 写入，避免 XSS。
 */
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  const TABS = ["overview", "problems", "ranking", "following"];

  const state = {
    ui: {
      tab: "overview",
      filters: { status: "all", difficulty: "all", tag: "all", keyword: "" },
      sort: "default",
      page: 1,
      pageSize: 50,
      rankRule: "acm"
    },
    slices: {
      overview: null,
      problems: null,
      ranking: null,
      following: null,
      followProfile: null,
      capsules: null,
      problemBoard: null
    },
    sliceErrors: {},
    loading: {},
    queue: { items: [], cursor: "" },
    auth: { username: null },
    drawerOpen: false,
    drawerMode: "profile",
    boardProblem: null,
    boardSort: "firstAc",
    requestCounter: 0,
    pending: new Map(),
    keywordTimer: null,
    keywordFocused: false
  };

  const app = document.getElementById("app");
  const panes = {
    overview: document.getElementById("pane-overview"),
    problems: document.getElementById("pane-problems"),
    ranking: document.getElementById("pane-ranking"),
    following: document.getElementById("pane-following")
  };
  const drawer = document.getElementById("drawer");
  const drawerTitle = document.getElementById("drawer-title");
  const drawerBody = document.getElementById("drawer-body");

  // ------------------------------------------------------------------ utils

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    return node;
  }

  function button(label, onClick, className) {
    const node = el("button", className || "btn small", label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
    return node;
  }

  function send(type, payload) {
    const message = Object.assign({ type }, payload || {});
    if (payload && payload.requestId === undefined && type === "refresh") {
      // 请求编号由下面统一注入。
    }
    vscode.postMessage(message);
  }

  function request(slice, force) {
    const id = ++state.requestCounter;
    state.pending.set(slice, id);
    state.loading[slice] = true;
    send("refresh", { slice, force: Boolean(force), requestId: id });
    renderTab(state.ui.tab);
    return id;
  }

  function formatNumber(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return String(value);
    }
    return new Intl.NumberFormat("zh-CN").format(number);
  }

  function formatPercent(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "—";
    }
    return `${Math.round(Number(value) * 10) / 10}%`;
  }

  function formatDateTime(iso) {
    if (!iso) {
      return "—";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return String(iso);
    }
    const now = Date.now();
    const diff = now - date.getTime();
    if (diff >= 0 && diff < 60 * 1000) {
      return "刚刚";
    }
    if (diff >= 0 && diff < 60 * 60 * 1000) {
      return `${Math.floor(diff / 60000)} 分钟前`;
    }
    if (diff >= 0 && diff < 24 * 60 * 60 * 1000) {
      return `${Math.floor(diff / 3600000)} 小时前`;
    }
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  /** 首 AC、做题用时等历史时间必须带年份，避免跨年份记录看起来像今年。 */
  function formatFullDate(iso) {
    if (!iso) {
      return "—";
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return String(iso);
    }
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
  }

  function formatDuration(ms) {
    const total = Number(ms);
    if (!Number.isFinite(total) || total < 0) {
      return "—";
    }
    if (total < 1000) {
      return "<1 秒";
    }
    const seconds = Math.floor(total / 1000);
    if (seconds < 60) {
      return `${seconds} 秒`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} 小时 ${String(minutes % 60).padStart(2, "0")} 分`;
    }
    const days = Math.floor(hours / 24);
    return `${days} 天 ${String(hours % 24).padStart(2, "0")} 小时`;
  }

  function resultClass(resultKey) {
    if (resultKey === "AC") {
      return "status-solved";
    }
    if (resultKey === "Pending" || resultKey === "Judging" || resultKey === "Submitting") {
      return "muted";
    }
    return "status-attempted";
  }

  function statusSymbol(status) {
    if (status === "solved") {
      return "✓";
    }
    if (status === "attempted") {
      return "−";
    }
    return "○";
  }

  function statusClass(status) {
    if (status === "solved") {
      return "status-solved";
    }
    if (status === "attempted") {
      return "status-attempted";
    }
    return "status-todo";
  }

  function safeImage(url) {
    const text = String(url || "");
    if (/^(https?:)?\/\//i.test(text)) {
      return text.startsWith("//") ? `https:${text}` : text;
    }
    if (/^data:image\//i.test(text)) {
      return text;
    }
    // 站点头像常是相对路径，用当前站点 origin 补全。
    const origin = state.auth && state.auth.baseUrl ? String(state.auth.baseUrl) : "";
    if (origin && text.startsWith("/")) {
      return `${origin.replace(/\/+$/, "")}${text}`;
    }
    return "";
  }

  function setAvatar(node, name, avatar) {
    clear(node);
    const url = safeImage(avatar);
    if (url) {
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = url;
      node.appendChild(img);
    } else {
      node.textContent = String(name || "X").slice(0, 1).toUpperCase();
    }
  }

  function table(headers, rows, options) {
    const wrap = el("div", "table-wrap");
    const tbl = el("table");
    const thead = el("thead");
    const headRow = el("tr");
    headers.forEach((header) => {
      const th = el("th", header.num ? "num" : "", header.label);
      if (header.title) {
        th.title = header.title;
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    tbl.appendChild(thead);
    const tbody = el("tbody");
    (rows || []).forEach((row) => tbody.appendChild(row));
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    if (options && options.empty) {
      wrap.appendChild(el("div", "empty", options.empty));
    }
    return wrap;
  }

  function cell(text, className) {
    return el("td", className || "", text);
  }

  function errorLine(message) {
    return el("div", "error-line", message);
  }

  function skeleton() {
    return el("div", "skeleton");
  }

  function showToast(level, message) {
    const container = document.getElementById("toasts");
    const node = el("div", `toast ${level || "info"}`, message);
    container.appendChild(node);
    setTimeout(() => {
      node.style.opacity = "0";
      setTimeout(() => node.remove(), 200);
    }, level === "error" ? 6000 : 3500);
  }

  // ---------------------------------------------------------------- header

  function renderHeader() {
    const overview = state.slices.overview;
    const nameNode = document.getElementById("identity-name");
    const metaNode = document.getElementById("identity-meta");
    const rankNode = document.getElementById("identity-rank");
    const avatarNode = document.getElementById("identity-avatar");
    const loginButton = document.getElementById("btn-login");

    if (!overview) {
      nameNode.textContent = "未登录";
      metaNode.textContent = "正在同步…";
      rankNode.hidden = true;
      loginButton.hidden = false;
      return;
    }
    const profile = overview.profile;
    const username = overview.username || (state.auth && state.auth.username) || "";
    nameNode.textContent = profile ? profile.username : username || "未登录";
    setAvatar(avatarNode, profile ? profile.username : username, profile && profile.avatar);
    loginButton.hidden = Boolean(profile) || Boolean(state.auth && state.auth.username);

    const rank = overview.rank;
    if (rank && rank.status === "ranked") {
      rankNode.hidden = false;
      rankNode.textContent = `#${rank.rank} / ${formatNumber(rank.total)}`;
      rankNode.title = `全站第 ${rank.rank} 名${rank.tieEnd > rank.tieStart ? `（并列 ${rank.tieStart}-${rank.tieEnd}）` : ""}`;
    } else if (rank && rank.status === "unranked") {
      rankNode.hidden = false;
      rankNode.textContent = "未上榜";
      rankNode.title = "当前没有 AC 记录，完成一题即可上榜";
    } else {
      rankNode.hidden = true;
    }

    const bits = [];
    if (profile) {
      bits.push(`AC ${formatNumber(profile.acceptedNumber)}`);
      bits.push(`提交 ${formatNumber(profile.submissionNumber)}`);
      if (profile.passRate !== null) {
        bits.push(`通过率 ${formatPercent(profile.passRate)}`);
      }
      if (profile.totalScore) {
        bits.push(`总分 ${formatNumber(profile.totalScore)}`);
      }
    } else if (overview.identityError) {
      bits.push(overview.identityError);
    } else {
      bits.push("已做状态来自本地记录");
    }
    if (overview.catalogLoaded) {
      bits.push(`目录 ${formatNumber(overview.stats.total)} 题`);
    }
    if (overview.identityError && profile) {
      bits.push(overview.identityError);
    }
    metaNode.textContent = bits.join(" · ");
    metaNode.title = metaNode.textContent;
  }

  // ------------------------------------------------------------------ tabs

  function renderTabs() {
    document.querySelectorAll(".tab").forEach((node) => {
      const active = node.getAttribute("data-tab") === state.ui.tab;
      node.classList.toggle("active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
    });
    TABS.forEach((tab) => {
      panes[tab].classList.toggle("active", tab === state.ui.tab);
    });
  }

  function switchTab(tab) {
    if (!TABS.includes(tab)) {
      return;
    }
    state.ui.tab = tab;
    send("setTab", { tab });
    renderTabs();
    renderTab(tab);
  }

  function renderTab(tab) {
    if (tab === "overview") {
      renderOverview();
    } else if (tab === "problems") {
      renderProblems();
    } else if (tab === "ranking") {
      renderRanking();
    } else if (tab === "following") {
      renderFollowing();
    }
  }

  // -------------------------------------------------------------- overview

  function statCard(value, label, hint, tone) {
    const card = el("div", `stat-card${tone ? ` ${tone}` : ""}`);
    card.appendChild(el("div", "value", value));
    card.appendChild(el("div", "label", label));
    if (hint) {
      card.appendChild(el("div", "hint", hint));
    }
    return card;
  }

  function renderOverview() {
    const pane = clear(panes.overview);
    const data = state.slices.overview;
    if (!data) {
      pane.appendChild(skeleton());
      return;
    }
    if (state.sliceErrors.overview) {
      pane.appendChild(errorLine(state.sliceErrors.overview));
    }
    if (data.identityError && !data.profile) {
      const hint = el("div", "card");
      hint.appendChild(el("p", "", data.identityError));
      hint.appendChild(
        button("登录 XMUOJ", () => send("login"), "btn")
      );
      pane.appendChild(hint);
    }

    const container = el("div", "stack");
    const stats = data.stats || { total: 0, solved: 0, attempted: 0, todo: 0 };
    const rank = data.rank;
    const rankValue =
      rank && rank.status === "ranked"
        ? `#${formatNumber(rank.rank)}`
        : rank && rank.status === "unranked"
          ? "未上榜"
          : rank && rank.loading
            ? "计算中…"
            : "—";
    const rankHint =
      rank && rank.status === "ranked"
        ? `共 ${formatNumber(rank.total)} 人${rank.tieEnd > rank.tieStart ? ` · 并列 ${rank.tieStart}-${rank.tieEnd}` : ""}`
        : rank && rank.status === "unranked"
          ? "完成一题即可上榜"
          : "切换到「排行」查看 Top 50";
    const cards = el("div", "grid-4");
    cards.appendChild(statCard(formatNumber(stats.solved), "已通过", `共 ${formatNumber(stats.total)} 题`, "accent"));
    cards.appendChild(statCard(formatNumber(stats.attempted), "尝试过", "有提交但未 AC"));
    cards.appendChild(statCard(formatNumber(stats.todo), "还没做", "从题库挑一道开始"));
    cards.appendChild(statCard(rankValue, "全站排名", rankHint));
    container.appendChild(cards);

    const grid = el("div", "grid-2");

    const difficulty = el("div", "card");
    difficulty.appendChild(el("h3", "", "难度进度"));
    const list = data.difficultyStats || [];
    if (!list.length) {
      difficulty.appendChild(el("p", "muted", "题目目录尚未加载"));
    } else {
      list.forEach((item) => {
        const row = el("div", "bar-row");
        row.appendChild(el("span", "muted", item.label));
        const track = el("div", "bar-track");
        const fill = el("div", "bar-fill");
        const ratio = item.total > 0 ? (item.solved / item.total) * 100 : 0;
        fill.style.width = `${Math.max(0, Math.min(100, ratio))}%`;
        if (ratio < 30) {
          fill.classList.add("warn");
        }
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "bar-value", `${item.solved} / ${item.total}`));
        difficulty.appendChild(row);
      });
    }
    grid.appendChild(difficulty);

    const follows = el("div", "card");
    follows.appendChild(el("h3", "", "关注的人"));
    if (!data.follows || !data.follows.length) {
      follows.appendChild(el("p", "muted", "还没有关注任何人。去「排行」点一个名字试试。"));
    } else {
      data.follows.forEach((user) => {
        const row = el("div", "race-participant");
        const title = el("strong", "", user.username);
        title.style.cursor = "pointer";
        title.addEventListener("click", () => openProfile(user.username));
        row.appendChild(title);
        row.appendChild(
          el(
            "div",
            "muted",
            `AC ${formatNumber(user.acceptedNumber)} · 提交 ${formatNumber(user.submissionNumber)}`
          )
        );
        if (user.recentSubmission) {
          row.appendChild(
            el(
              "div",
              "muted",
              `最近：${user.recentSubmission.problemDisplayId || ""} ${user.recentSubmission.resultKey} · ${formatDateTime(user.recentSubmission.createdAt)}`
            )
          );
        }
        follows.appendChild(row);
      });
    }
    grid.appendChild(follows);
    container.appendChild(grid);

    const recent = el("div", "card");
    recent.appendChild(el("h3", "", "最近提交"));
    if (!data.recentSubmissions || !data.recentSubmissions.length) {
      recent.appendChild(el("p", "muted", "暂无提交记录"));
    } else {
      const rows = data.recentSubmissions.map((submission) => {
        const tr = el("tr");
        const problem = el("td", "code-cell", submission.problemDisplayId || "—");
        problem.style.cursor = "pointer";
        problem.addEventListener("click", () => {
          if (submission.problemDisplayId) {
            send("openProblem", { id: submission.problemDisplayId });
          }
        });
        tr.appendChild(problem);
        tr.appendChild(cell(submission.resultKey || submission.resultLabel || "—", resultClass(submission.resultKey)));
        tr.appendChild(cell(submission.language || "—"));
        tr.appendChild(cell(formatDateTime(submission.createdAt), "muted"));
        tr.appendChild(cell(submission.timeCost !== null && submission.timeCost !== undefined ? `${submission.timeCost} ms` : "—", "num hide-narrow"));
        return tr;
      });
      recent.appendChild(
        table(
          [
            { label: "题目" },
            { label: "结果" },
            { label: "语言" },
            { label: "时间" },
            { label: "耗时", num: true }
          ],
          rows
        )
      );
    }
    container.appendChild(recent);

    const bottom = el("div", "grid-2");
    const contests = el("div", "card");
    contests.appendChild(el("h3", "", "我的实验战绩"));
    if (!data.contests || !data.contests.length) {
      contests.appendChild(el("p", "muted", "暂无实验记录"));
    } else {
      data.contests.forEach((contest) => {
        const line = el("div", "stats-line");
        line.style.marginBottom = "6px";
        line.appendChild(el("span", "", contest.title || `实验 ${contest.contestId}`));
        line.appendChild(el("span", "", `AC ${contest.acCount}`));
        if (contest.myRank) {
          line.appendChild(el("span", "", `名次 #${contest.myRank}`));
        }
        if (contest.totalScore) {
          line.appendChild(el("span", "", `得分 ${contest.totalScore}`));
        }
        contests.appendChild(line);
      });
    }
    bottom.appendChild(contests);

    const raceCard = el("div", "card");
    raceCard.appendChild(el("h3", "", "题库竞速"));
    raceCard.appendChild(
      el(
        "p",
        "muted",
        "竞速只在「我的题库」中的题库实验里提供。比较成绩的实验和考试不开放竞速，避免作弊。"
      )
    );
    raceCard.appendChild(
      el("p", "muted", "在侧边栏展开「我的题库」，右键题库选择「题库竞速」即可。")
    );
    bottom.appendChild(raceCard);
    container.appendChild(bottom);

    pane.appendChild(container);
  }

  // --------------------------------------------------------------- problems

  function selectField(label, value, options, onChange) {
    const wrap = el("label");
    wrap.appendChild(document.createTextNode(label));
    const select = el("select");
    options.forEach((option) => {
      const node = el("option", "", option.label);
      node.value = option.value;
      if (String(option.value) === String(value)) {
        node.selected = true;
      }
      select.appendChild(node);
    });
    select.addEventListener("change", () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
  }

  function persistUi() {
    send("persistUi", { ui: state.ui });
  }

  /** 已录制胶囊的题目键（数字 id + 展示号），用于题库行「有回放」标记。 */
  function capsuleBadgeKeys() {
    const data = state.slices.capsules;
    const items = data && Array.isArray(data.items) ? data.items : [];
    const keys = new Set();
    for (const entry of items) {
      const problem = (entry && entry.problem) || {};
      if (problem.id !== undefined && problem.id !== null) {
        keys.add(`id:${String(problem.id)}`);
      }
      if (problem.displayId) {
        keys.add(`display:${String(problem.displayId).toLowerCase()}`);
      }
    }
    return keys;
  }

  function renderProblems() {
    const pane = clear(panes.problems);
    const data = state.slices.problems;
    const error = state.sliceErrors.problems;
    if (error) {
      pane.appendChild(errorLine(error));
    }
    if (!data) {
      pane.appendChild(skeleton());
      return;
    }

    const toolbar = el("div", "toolbar");
    toolbar.appendChild(
      selectField(
        "状态",
        state.ui.filters.status,
        [
          { value: "all", label: "全部" },
          { value: "todo", label: "还没做" },
          { value: "attempted", label: "尝试过" },
          { value: "solved", label: "已通过" },
          { value: "local", label: "本地有记录" }
        ],
        (value) => {
          state.ui.filters.status = value;
          state.ui.page = 1;
          persistUi();
          renderProblems();
        }
      )
    );

    const difficulties = [{ value: "all", label: "全部难度" }].concat(
      (data.difficultyStats || []).map((item) => ({ value: item.key, label: item.label }))
    );
    toolbar.appendChild(
      selectField("难度", state.ui.filters.difficulty, difficulties, (value) => {
        state.ui.filters.difficulty = value;
        state.ui.page = 1;
        persistUi();
        renderProblems();
      })
    );

    const tags = [{ value: "all", label: "全部标签" }].concat(
      (data.tags || []).map((tag) => ({ value: tag.name, label: `${tag.name} (${tag.count})` }))
    );
    toolbar.appendChild(
      selectField("标签", state.ui.filters.tag, tags, (value) => {
        state.ui.filters.tag = value;
        state.ui.page = 1;
        persistUi();
        renderProblems();
      })
    );

    const searchWrap = el("label");
    searchWrap.appendChild(document.createTextNode("搜索"));
    const search = el("input");
    search.type = "search";
    search.placeholder = "题号或标题";
    search.value = state.ui.filters.keyword || "";
    search.addEventListener("focus", () => {
      state.keywordFocused = true;
    });
    search.addEventListener("blur", () => {
      state.keywordFocused = false;
      // 等点击事件处理完再重绘，避免按钮在 mousedown 后被替换。
      setTimeout(() => {
        if (!state.keywordFocused && state.ui.tab === "problems") {
          renderProblems();
        }
      }, 250);
    });
    search.addEventListener("input", () => {
      state.ui.filters.keyword = search.value;
      state.ui.page = 1;
      if (state.keywordTimer) {
        clearTimeout(state.keywordTimer);
      }
      state.keywordTimer = setTimeout(() => {
        state.keywordTimer = null;
        persistUi();
      }, 220);
    });
    searchWrap.appendChild(search);
    toolbar.appendChild(searchWrap);

    toolbar.appendChild(
      selectField(
        "排序",
        state.ui.sort,
        [
          { value: "default", label: "默认题号" },
          { value: "difficulty", label: "难度" },
          { value: "passRate", label: "通过率" },
          { value: "submissions", label: "提交数" },
          { value: "recent", label: "本地最近" }
        ],
        (value) => {
          state.ui.sort = value;
          state.ui.page = 1;
          persistUi();
          renderProblems();
        }
      )
    );

    if (state.loading.problems) {
      toolbar.appendChild(el("span", "muted", "正在同步题目目录…"));
    }
    pane.appendChild(toolbar);

    const stats = data.stats || { total: 0, solved: 0, attempted: 0, todo: 0 };
    const statsLine = el("div", "stats-line");
    statsLine.appendChild(el("span", "", `共 ${formatNumber(stats.total)} 题`));
    statsLine.appendChild(el("span", "status-solved", `已 AC ${formatNumber(stats.solved)}`));
    statsLine.appendChild(el("span", "status-attempted", `尝试 ${formatNumber(stats.attempted)}`));
    statsLine.appendChild(el("span", "", `未做 ${formatNumber(stats.todo)}`));
    statsLine.appendChild(el("span", "", `筛选后 ${formatNumber(data.filteredTotal)} 题`));
    const sortLabels = {
      default: "默认题号",
      difficulty: "难度",
      passRate: "通过率（高→低）",
      submissions: "提交数（多→少）",
      recent: "本地最近"
    };
    statsLine.appendChild(el("span", "", `排序：${sortLabels[data.sort] || "默认题号"}`));
    if (state.queue.items.length) {
      statsLine.appendChild(el("span", "", `队列 ${state.queue.items.length} 题`));
    }
    pane.appendChild(statsLine);

    if (!data.items || !data.items.length) {
      const empty = el("div", "empty");
      empty.appendChild(el("p", "", "没有符合条件的题目。"));
      if (state.ui.filters.keyword || state.ui.filters.status !== "all" || state.ui.filters.difficulty !== "all" || state.ui.filters.tag !== "all") {
        empty.appendChild(
          button("清除筛选", () => {
            state.ui.filters = { status: "all", difficulty: "all", tag: "all", keyword: "" };
            state.ui.page = 1;
            persistUi();
            renderProblems();
          })
        );
      }
      pane.appendChild(empty);
      return;
    }

    const capsuleKeys = capsuleBadgeKeys();
    const rows = data.items.map((problem) => {
      const tr = el("tr");
      tr.appendChild(cell(statusSymbol(problem.status), `status-dot ${statusClass(problem.status)}`));
      const code = cell(problem.displayId, "code-cell");
      code.style.cursor = "pointer";
      code.title = "查看题面";
      code.addEventListener("click", () => send("openProblem", { id: problem.id }));
      tr.appendChild(code);

      const titleCell = el("td", "title-cell");
      titleCell.appendChild(el("div", "", problem.title));
      const sub = el("div", "sub");
      if (problem.statusSource === "local") {
        sub.appendChild(el("span", "pill local", "本地"));
      }
      if (problem.conflict) {
        sub.appendChild(el("span", "pill local", "本地 AC / 站点未记录"));
      }
      if (problem.inQueue) {
        sub.appendChild(el("span", "pill ok", "队列中"));
      }
      const hasCapsule =
        capsuleKeys.has(`id:${String(problem.id)}`) ||
        Boolean(problem.displayId && capsuleKeys.has(`display:${String(problem.displayId).toLowerCase()}`));
      if (hasCapsule) {
        sub.appendChild(el("span", "pill ok", "有回放"));
      }
      if (problem.localLabel) {
        sub.appendChild(el("span", "", problem.localLabel));
      }
      titleCell.appendChild(sub);
      tr.appendChild(titleCell);

      tr.appendChild(cell(problem.difficulty || "—", "muted"));
      const tagsCell = el("td", "hide-narrow");
      (problem.tags || []).slice(0, 3).forEach((tag) => tagsCell.appendChild(el("span", "pill", tag)));
      tr.appendChild(tagsCell);
      tr.appendChild(cell(formatPercent(problem.passRate), "num"));
      tr.appendChild(cell(formatNumber(problem.submissionNumber), "num hide-narrow"));

      const actions = el("td", "actions-cell");
      actions.appendChild(button("开刷", () => send("startProblem", { id: problem.id })));
      actions.appendChild(
        button(
          problem.inQueue ? "移出队列" : "加入队列",
          () => send(problem.inQueue ? "removeQueue" : "addQueue", { id: problem.id }),
          "btn ghost small"
        )
      );
      actions.appendChild(
        button("排行", () => openProblemBoard(problem.displayId), "btn ghost small")
      );
      tr.appendChild(actions);
      return tr;
    });

    pane.appendChild(
      table(
        [
          { label: "" },
          { label: "题号" },
          { label: "题目" },
          { label: "难度" },
          { label: "标签" },
          { label: "通过率", num: true },
          { label: "提交", num: true },
          { label: "操作" }
        ],
        rows
      )
    );

    const pager = el("div", "pager");
    pager.appendChild(
      button(
        "上一页",
        () => {
          state.ui.page = Math.max(1, state.ui.page - 1);
          persistUi();
          renderProblems();
        },
        "btn secondary small"
      )
    );
    pager.appendChild(
      el("span", "page-info", `第 ${data.page} / ${data.totalPages} 页 · 每页 ${data.pageSize}`)
    );
    pager.appendChild(
      button(
        "下一页",
        () => {
          state.ui.page = Math.min(data.totalPages, state.ui.page + 1);
          persistUi();
          renderProblems();
        },
        "btn secondary small"
      )
    );
    pane.appendChild(pager);
  }

  // ---------------------------------------------------------------- ranking

  function renderRanking() {
    const pane = clear(panes.ranking);
    const data = state.slices.ranking;
    const error = state.sliceErrors.ranking;
    if (error) {
      pane.appendChild(errorLine(error));
    }
    if (!data) {
      pane.appendChild(skeleton());
      return;
    }

    const toolbar = el("div", "toolbar");
    ["acm", "oi"].forEach((rule) => {
      const active = state.ui.rankRule === rule;
      toolbar.appendChild(
        button(
          rule === "acm" ? "ACM 榜" : "OI 榜",
          () => {
            state.ui.rankRule = rule;
            persistUi();
            send("setRankRule", { rule });
            renderRanking();
          },
          `btn ${active ? "" : "ghost"} small`
        )
      );
    });
    if (data.loading) {
      toolbar.appendChild(el("span", "muted", "正在计算全站排名…"));
    }
    if (data.truncated) {
      toolbar.appendChild(el("span", "muted", "榜单人数过多，只统计了前 2 万人"));
    }
    pane.appendChild(toolbar);

    const mine = el("div", "card");
    mine.style.marginBottom = "12px";
    const mineLine = el("div", "stats-line");
    mineLine.style.marginBottom = "0";
    if (data.status === "ranked") {
      mineLine.appendChild(el("span", "badge rank-badge", `#${data.rank}`));
      mineLine.appendChild(el("span", "", `共 ${formatNumber(data.total)} 人`));
      if (data.tieEnd > data.tieStart) {
        mineLine.appendChild(el("span", "", `并列 ${data.tieStart}-${data.tieEnd}`));
      }
      if (data.percentile !== null && data.percentile !== undefined) {
        mineLine.appendChild(el("span", "", `前 ${Math.max(1, Math.round(data.percentile))}%`));
      }
    } else if (data.status === "unranked") {
      mineLine.appendChild(el("strong", "", "未上榜"));
      mineLine.appendChild(el("span", "muted", "当前还没有 AC 记录"));
    } else if (data.loading) {
      mineLine.appendChild(el("span", "muted", "计算中…"));
    } else if (!state.auth.username && !(state.slices.overview && state.slices.overview.profile)) {
      mineLine.appendChild(el("span", "muted", "登录后显示你的精确名次"));
    } else {
      mineLine.appendChild(el("strong", "", "未进入榜单"));
      mineLine.appendChild(el("span", "muted", "站点榜单里没有找到这个账号"));
    }
    mine.appendChild(mineLine);
    pane.appendChild(mine);

    const rows = (data.rows || []).map((row) => {
      const tr = el("tr");
      tr.appendChild(cell(`#${row.position}`, "num"));
      const userCell = el("td");
      const name = el("span", "", row.username);
      name.style.cursor = "pointer";
      name.style.fontWeight = "600";
      name.addEventListener("click", () => openProfile(row.username));
      userCell.appendChild(name);
      if (row.following) {
        userCell.appendChild(el("span", "pill ok", "已关注"));
      }
      tr.appendChild(userCell);
      tr.appendChild(cell(row.school || "—", "muted hide-narrow"));
      tr.appendChild(cell(formatNumber(row.acceptedNumber), "num"));
      tr.appendChild(cell(formatNumber(row.submissionNumber), "num hide-narrow"));
      tr.appendChild(cell(formatPercent(row.passRate), "num"));
      tr.appendChild(cell(formatNumber(state.ui.rankRule === "oi" ? row.totalScore : row.totalScore), "num"));
      const actions = el("td", "actions-cell");
      actions.appendChild(
        button(
          row.following ? "取关" : "关注",
          () => send(row.following ? "unfollow" : "follow", { username: row.username }),
          "btn ghost small"
        )
      );
      tr.appendChild(actions);
      return tr;
    });
    const headers = [
      { label: "名次", num: true },
      { label: "用户" },
      { label: "学校" },
      { label: "AC", num: true },
      { label: "提交", num: true },
      { label: "通过率", num: true },
      { label: state.ui.rankRule === "oi" ? "总分" : "总分", num: true },
      { label: "操作" }
    ];
    if (!rows.length) {
      pane.appendChild(
        data.loading ? skeleton() : el("div", "empty", "榜单暂时没有数据")
      );
    } else {
      pane.appendChild(table(headers, rows));
    }
  }

  // -------------------------------------------------------------- following

  function renderFollowing() {
    const pane = clear(panes.following);
    const data = state.slices.following;
    const error = state.sliceErrors.following;
    if (error) {
      pane.appendChild(errorLine(error));
    }

    const form = el("div", "toolbar");
    const input = el("input");
    input.type = "text";
    input.placeholder = "输入站点用户名，例如 alice";
    form.appendChild(input);
    form.appendChild(
      button(
        "关注",
        () => {
          const username = input.value.trim();
          if (!username) {
            showToast("warn", "请输入用户名");
            return;
          }
          send("follow", { username });
          input.value = "";
        },
        "btn"
      )
    );
    pane.appendChild(form);

    if (!data) {
      pane.appendChild(skeleton());
      return;
    }
    if (!data.users || !data.users.length) {
      pane.appendChild(
        el("div", "empty", "还没有关注任何人。可以在「排行」里点用户名关注，或在上方直接输入。")
      );
      return;
    }

    const rows = data.users.map((user) => {
      const tr = el("tr");
      const nameCell = el("td");
      const name = el("strong", "", user.username);
      name.style.cursor = "pointer";
      name.addEventListener("click", () => openProfile(user.username));
      nameCell.appendChild(name);
      if (user.loading) {
        nameCell.appendChild(el("span", "pill", "加载中"));
      }
      tr.appendChild(nameCell);
      tr.appendChild(cell(user.rank ? `#${user.rank}` : user.position ? `#${user.position}` : "—", "num"));
      tr.appendChild(cell(user.acceptedNumber === null ? "—" : formatNumber(user.acceptedNumber), "num"));
      tr.appendChild(cell(user.submissionNumber === null ? "—" : formatNumber(user.submissionNumber), "num"));
      tr.appendChild(cell(user.totalScore === null ? "—" : formatNumber(user.totalScore), "num hide-narrow"));
      tr.appendChild(
        cell(
          user.recentSubmission
            ? `${user.recentSubmission.problemDisplayId || ""} ${user.recentSubmission.resultKey} · ${formatDateTime(user.recentSubmission.createdAt)}`
            : user.error || "暂无可公开数据",
          "muted"
        )
      );
      const actions = el("td", "actions-cell");
      actions.appendChild(
        button("取关", () => send("unfollow", { username: user.username }), "btn ghost small")
      );
      tr.appendChild(actions);
      return tr;
    });
    pane.appendChild(
      table(
        [
          { label: "用户" },
          { label: "名次", num: true },
          { label: "AC", num: true },
          { label: "提交", num: true },
          { label: "总分", num: true },
          { label: "最近提交" },
          { label: "操作" }
        ],
        rows
      )
    );
  }

  // ----------------------------------------------------------------- drawer

  function openProfile(username) {
    const name = String(username || "").trim();
    if (!name) {
      return;
    }
    state.drawerOpen = true;
    state.drawerMode = "profile";
    drawer.hidden = false;
    drawerTitle.textContent = name;
    clear(drawerBody).appendChild(skeleton());
    state.slices.followProfile = null;
    send("openProfile", { username: name });
  }

  function openProblemBoard(displayId) {
    const key = String(displayId || "").trim();
    if (!key) {
      return;
    }
    state.drawerOpen = true;
    state.drawerMode = "board";
    state.boardProblem = key;
    state.slices.problemBoard = null;
    state.loading.problemBoard = true;
    drawer.hidden = false;
    drawerTitle.textContent = `${key} · 本题排行`;
    clear(drawerBody).appendChild(skeleton());
    send("loadProblemBoard", { problemId: key });
  }

  function closeDrawer() {
    state.drawerOpen = false;
    state.drawerMode = "profile";
    state.boardProblem = null;
    drawer.hidden = true;
  }

  function renderDrawer() {
    if (!state.drawerOpen) {
      return;
    }
    if (state.drawerMode === "board") {
      renderBoardDrawer();
      return;
    }
    const data = state.slices.followProfile;
    if (!data) {
      return;
    }
    drawerTitle.textContent = data.username || "用户资料";
    const body = clear(drawerBody);
    if (state.sliceErrors.followProfile) {
      body.appendChild(errorLine(state.sliceErrors.followProfile));
    }
    const top = el("div", "card");
    const head = el("div", "identity-main");
    const avatar = el("div", "avatar");
    setAvatar(avatar, data.username, data.avatar);
    head.appendChild(avatar);
    const info = el("div");
    info.appendChild(el("strong", "", data.username));
    if (data.school) {
      info.appendChild(el("div", "muted", data.school));
    }
    if (data.rank) {
      info.appendChild(el("div", "muted", `全站第 ${data.rank} 名`));
    } else if (data.found === false) {
      info.appendChild(el("div", "muted", "暂无可公开数据"));
    }
    head.appendChild(info);
    top.appendChild(head);
    body.appendChild(top);

    const stats = el("dl", "kv");
    stats.style.marginTop = "12px";
    [
      ["AC", data.acceptedNumber === null ? "—" : formatNumber(data.acceptedNumber)],
      ["提交", data.submissionNumber === null ? "—" : formatNumber(data.submissionNumber)],
      ["总分", data.totalScore === null ? "—" : formatNumber(data.totalScore)],
      ["名次", data.rank ? `#${data.rank}` : data.position ? `#${data.position}` : "—"]
    ].forEach(([key, value]) => {
      stats.appendChild(el("dt", "", key));
      stats.appendChild(el("dd", "", value));
    });
    body.appendChild(stats);

    const actions = el("div", "toolbar");
    actions.style.marginTop = "12px";
    actions.appendChild(
      button(
        data.followed ? "取消关注" : "关注",
        () => {
          send(data.followed ? "unfollow" : "follow", { username: data.username });
          setTimeout(() => {
            if (state.drawerOpen) {
              send("openProfile", { username: data.username });
            }
          }, 350);
        },
        "btn"
      )
    );
    body.appendChild(actions);

    const recentTitle = el("h3", "", "最近提交");
    recentTitle.style.marginTop = "16px";
    body.appendChild(recentTitle);
    if (!data.recentSubmissions || !data.recentSubmissions.length) {
      body.appendChild(el("p", "muted", "暂无公开提交"));
    } else {
      const rows = data.recentSubmissions.map((submission) => {
        const tr = el("tr");
        tr.appendChild(cell(submission.problemDisplayId || "—", "code-cell"));
        tr.appendChild(cell(submission.resultKey, resultClass(submission.resultKey)));
        tr.appendChild(cell(submission.language || "—", "muted"));
        tr.appendChild(cell(formatDateTime(submission.createdAt), "muted"));
        return tr;
      });
      body.appendChild(
        table([{ label: "题目" }, { label: "结果" }, { label: "语言" }, { label: "时间" }], rows)
      );
    }

    const contestTitle = el("h3", "", "实验战绩");
    contestTitle.style.marginTop = "16px";
    body.appendChild(contestTitle);
    if (!data.contests || !data.contests.length) {
      body.appendChild(el("p", "muted", "暂无实验记录"));
    } else {
      data.contests.forEach((contest) => {
        const line = el("div", "stats-line");
        line.style.marginBottom = "4px";
        line.appendChild(el("span", "", contest.title || `实验 ${contest.contestId}`));
        line.appendChild(el("span", "", `AC ${contest.acCount}`));
        if (contest.totalScore) {
          line.appendChild(el("span", "", `得分 ${contest.totalScore}`));
        }
        body.appendChild(line);
      });
    }
  }

  function renderBoardDrawer() {
    const body = clear(drawerBody);
    const data = state.slices.problemBoard;
    const displayId = state.boardProblem;
    if (!displayId) {
      body.appendChild(el("p", "muted", "请选择一道题。"));
      return;
    }
    if (!data || String(data.displayId) !== String(displayId)) {
      body.appendChild(skeleton());
      return;
    }
    const problem = data.problem || {};
    drawerTitle.textContent = `${displayId} ${problem.title || ""}`.trim();
    body.appendChild(el("h3", "", "本题榜单"));
    const boardModes = [
      {
        key: "firstAc",
        label: "首次 AC",
        hint:
          "按每位用户最早的 AC 时间排序，是历史首杀顺序。不同年份的同学会排在同一张榜上，日期已标明年份。"
      },
      {
        key: "fastest",
        label: "最快通过",
        hint:
          "按“该用户在此题上首次提交 → 首次 AC”的用时排序，跨年份可比；提交次数包含失败尝试。"
      },
      {
        key: "mostAccepted",
        label: "AC 次数",
        hint: "按 AC 次数排序，反映反复练习与重做的次数。"
      }
    ];
    if (!boardModes.some((mode) => mode.key === state.boardSort)) {
      state.boardSort = "firstAc";
    }
    const sortBar = el("div", "toolbar");
    boardModes.forEach((mode) => {
      const active = state.boardSort === mode.key;
      const node = button(
        mode.label,
        () => {
          state.boardSort = mode.key;
          renderBoardDrawer();
        },
        `btn ${active ? "" : "ghost"} small`
      );
      if (mode.key === "fastest" && !data.speedAvailable) {
        node.disabled = true;
        node.title = "需要完整的本题提交记录才能计算用时";
      }
      sortBar.appendChild(node);
    });
    body.appendChild(sortBar);
    const mode = boardModes.find((item) => item.key === state.boardSort) || boardModes[0];
    body.appendChild(el("p", "muted", mode.hint));
    if (data.error) {
      body.appendChild(errorLine(`部分数据加载失败：${data.error}`));
    }
    const stats = el("div", "stats-line");
    stats.appendChild(el("span", "", `提交 ${formatNumber(data.submissionTotal)}`));
    stats.appendChild(el("span", "status-solved", `AC ${formatNumber(data.acTotal)}`));
    stats.appendChild(el("span", "", `通过率 ${formatPercent(data.passRate)}`));
    stats.appendChild(
      el("span", "", `通过用户 ${formatNumber(data.uniqueAcceptedUsers)}`)
    );
    body.appendChild(stats);
    if (data.truncated) {
      body.appendChild(
        el(
          "p",
          "muted",
          "本题提交记录较多，只统计最近约 2500 条；更早的记录可能未进入榜单，用时也只是窗口内的近似值。"
        )
      );
    }

    const me = state.auth && state.auth.username;
    const list =
      state.boardSort === "fastest"
        ? data.fastest || []
        : state.boardSort === "mostAccepted"
          ? data.mostAccepted || []
          : data.rows || [];
    if (!list.length) {
      body.appendChild(el("p", "muted", "还没有可公开展示的 AC 记录。"));
    } else {
      const rows = list.slice(0, 100).map((row) => {
        const tr = el("tr");
        tr.appendChild(cell(`#${row.rank}`, "num"));
        const userCell = cell(row.username, "code-cell");
        userCell.style.cursor = "pointer";
        userCell.title = "查看资料";
        userCell.addEventListener("click", () => openProfile(row.username));
        if (me && row.username === me) {
          userCell.appendChild(el("span", "pill ok", "我"));
        }
        tr.appendChild(userCell);
        if (state.boardSort === "fastest") {
          tr.appendChild(cell(formatDuration(row.durationMs), "num"));
          tr.appendChild(cell(formatNumber(row.attempts), "num"));
          tr.appendChild(cell(formatFullDate(row.acceptedAt), "muted"));
        } else if (state.boardSort === "mostAccepted") {
          tr.appendChild(cell(formatNumber(row.acCount), "num"));
          tr.appendChild(cell(formatFullDate(row.acceptedAt), "muted"));
          tr.appendChild(cell(formatFullDate(row.latestAcceptedAt), "muted"));
        } else {
          tr.appendChild(cell(formatFullDate(row.acceptedAt), "muted"));
          tr.appendChild(cell(formatNumber(row.acCount), "num"));
        }
        return tr;
      });
      const headers =
        state.boardSort === "fastest"
          ? [
              { label: "名次", num: true },
              { label: "用户" },
              { label: "用时", num: true },
              { label: "提交次数", num: true },
              { label: "首次 AC" }
            ]
          : state.boardSort === "mostAccepted"
            ? [
                { label: "名次", num: true },
                { label: "用户" },
                { label: "AC 次数", num: true },
                { label: "首次 AC" },
                { label: "最近 AC" }
              ]
            : [
                { label: "名次", num: true },
                { label: "用户" },
                { label: "首次 AC" },
                { label: "AC 次数", num: true }
              ];
      body.appendChild(table(headers, rows));
      if (list.length > 100) {
        body.appendChild(
          el("p", "muted", `共 ${list.length} 位通过用户，只显示前 100 位。`)
        );
      }
    }

    const recentTitle = el("h3", "", "最近提交");
    recentTitle.style.marginTop = "16px";
    body.appendChild(recentTitle);
    if (!data.recent || !data.recent.length) {
      body.appendChild(el("p", "muted", "暂无公开提交"));
      return;
    }
    const recentRows = data.recent.map((submission) => {
      const tr = el("tr");
      const userCell = cell(submission.username || "—", "code-cell");
      userCell.style.cursor = "pointer";
      userCell.addEventListener("click", () => openProfile(submission.username));
      tr.appendChild(userCell);
      tr.appendChild(cell(submission.resultKey || "—", resultClass(submission.resultKey)));
      tr.appendChild(cell(submission.language || "—", "muted"));
      tr.appendChild(cell(formatFullDate(submission.createdAt), "muted"));
      return tr;
    });
    body.appendChild(
      table(
        [
          { label: "用户" },
          { label: "结果" },
          { label: "语言" },
          { label: "时间" }
        ],
        recentRows
      )
    );
  }

  // -------------------------------------------------------------- messaging

  function applySnapshot(message) {
    const slice = message.slice;
    if (!slice) {
      return;
    }
    if (message.requestId !== undefined && state.pending.has(slice)) {
      if (state.pending.get(slice) !== message.requestId) {
        return;
      }
      state.pending.delete(slice);
    }
    state.loading[slice] = false;
    state.slices[slice] = message.data;
    if (message.meta && message.meta.error) {
      state.sliceErrors[slice] = message.meta.error;
    } else {
      delete state.sliceErrors[slice];
    }
    if (slice === "overview") {
      renderHeader();
    }
    if (slice === "problems" && message.data && message.data.filters) {
      // 扩展侧是权威 UI 状态；输入框正在编辑时不重建 DOM，避免光标跳动。
      if (!state.keywordFocused) {
        state.ui.filters = message.data.filters;
        state.ui.sort = message.data.sort;
        state.ui.page = message.data.page;
      } else {
        state.ui.page = message.data.page || state.ui.page;
      }
    }
    if (slice === "problemBoard") {
      renderDrawer();
      return;
    }
    if (!(slice === "problems" && state.keywordFocused)) {
      renderTab(state.ui.tab);
    }
    if (slice === "followProfile") {
      renderDrawer();
    }
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") {
      return;
    }
    switch (message.type) {
      case "snapshot":
        applySnapshot(message);
        break;
      case "loading": {
        if (message.slice) {
          state.loading[message.slice] = true;
          if (message.slice === "followProfile") {
            if (state.drawerOpen) {
              clear(drawerBody).appendChild(skeleton());
            }
          } else {
            renderTab(state.ui.tab);
          }
        }
        break;
      }
      case "error": {
        const slice = message.slice || "overview";
        state.loading[slice] = false;
        state.sliceErrors[slice] = message.message || "加载失败";
        if (message.kind === "auth") {
          document.getElementById("btn-login").hidden = false;
        }
        if (slice === "followProfile") {
          renderDrawer();
        } else {
          renderTab(state.ui.tab);
        }
        break;
      }
      case "queue":
        state.queue = { items: message.items || [], cursor: message.cursor || "" };
        if (state.ui.tab === "problems") {
          renderProblems();
        }
        break;
      case "auth":
        state.auth = { username: message.username || null, baseUrl: message.baseUrl || "" };
        renderHeader();
        break;
      case "ui":
        if (message.ui && message.ui.tab) {
          state.ui.tab = message.ui.tab;
          state.ui.rankRule = message.ui.rankRule || state.ui.rankRule;
          renderTabs();
        }
        break;
      case "toast":
        showToast(message.level, message.message);
        break;
      default:
        break;
    }
  });

  // ------------------------------------------------------------------- init

  document.getElementById("tabs").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) {
      return;
    }
    switchTab(button.getAttribute("data-tab"));
  });
  document.getElementById("btn-refresh").addEventListener("click", () => request("all", true));
  document.getElementById("btn-login").addEventListener("click", () => send("login"));
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.drawerOpen) {
      closeDrawer();
    }
  });
  document.addEventListener("visibilitychange", () => {
    send("visibility", { visible: document.visibilityState === "visible" });
  });

  renderTabs();
  renderHeader();
  renderTab(state.ui.tab);
  send("ready");
})();
