/**
 * 题库竞速面板。扩展侧持有权威状态，这里只渲染并发送动作。
 */
"use strict";

const vscode = acquireVsCodeApi();

let current = null;
let problemSignature = "";
let toastTimer = null;
let startPending = false;
let joinPending = false;

function post(type, extra) {
  vscode.postMessage(Object.assign({ type }, extra || {}));
}

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

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatClock(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
  }
  return `${String(minutes).padStart(2, "0")}:${seconds}`;
}

function statusMark(status) {
  if (status === "solved") {
    return { text: "✓", className: "status-dot status-solved", label: "已通过" };
  }
  if (status === "attempted") {
    return { text: "−", className: "status-dot status-attempted", label: "尝试过" };
  }
  return { text: "○", className: "status-dot status-todo", label: "未做" };
}

function raceIsActive(data) {
  const race = data && data.race && data.race.active;
  return Boolean(
    race && !["finished", "cancelled", "expired"].includes(race.status)
  );
}

function raceStatusText(race) {
  if (!race) {
    return "";
  }
  if (race.status === "armed") {
    return "等待开始";
  }
  if (race.status === "settling") {
    return "等待判题落定";
  }
  if (race.status === "cancelled") {
    return "已取消";
  }
  if (race.status === "expired") {
    return "已超时";
  }
  if (race.status === "finished") {
    if (race.noWinner) {
      return "无人完成";
    }
    if (race.tie) {
      return "平局";
    }
    return race.winner ? `${race.winner} 获胜` : "已结束";
  }
  return "进行中";
}

function showToast(level, message) {
  const host = document.getElementById("toasts");
  if (!host) {
    return;
  }
  const node = el("div", `toast ${level || "info"}`, message);
  host.appendChild(node);
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    node.remove();
  }, 4200);
}

function preserveFocus(fn) {
  const active = document.activeElement;
  const id = active && active.id ? active.id : "";
  let start = null;
  let end = null;
  try {
    if (active && typeof active.selectionStart === "number") {
      start = active.selectionStart;
      end = active.selectionEnd;
    }
  } catch (_error) {
    start = null;
  }
  fn();
  if (id) {
    const node = document.getElementById(id);
    if (node && typeof node.focus === "function") {
      node.focus();
      if (start !== null && typeof node.setSelectionRange === "function") {
        try {
          node.setSelectionRange(start, end);
        } catch (_error) {
          // 某些 input 类型不支持选区，忽略。
        }
      }
    }
  }
}

function renderHeader(data) {
  const contest = data.contest || {};
  document.getElementById("contest-title").textContent = contest.title || "题库竞速";
  const badge = document.getElementById("contest-badge");
  badge.textContent = data.canRace ? "题库 · 可竞速" : "禁止竞速";
  const stats = data.stats || {};
  const parts = [
    contest.ruleType ? `规则 ${contest.ruleType}` : "",
    `${stats.total || 0} 题`,
    `已通过 ${stats.solved || 0}`,
    `尝试 ${stats.attempted || 0}`,
    `未做 ${stats.todo || 0}`,
    data.me ? `账号 ${data.me}` : "未登录"
  ].filter(Boolean);
  document.getElementById("contest-meta").textContent = parts.join(" · ");
}

function renderWarning(data) {
  const node = document.getElementById("warning");
  let message = data.warning || "";
  if (!message && data.contest && data.contest.isExam) {
    message = "这是考试实验，已禁止竞速，避免影响成绩。";
  }
  if (!message && !data.canRace) {
    message = "只有题库提供竞速；实验和考试不提供。";
  }
  if (!message && !data.loggedIn) {
    message = "未登录：可以查看题目，登录后才能发起或加入竞速。";
  }
  node.hidden = !message;
  node.textContent = message;
}

function renderProblemOptions(data) {
  const select = document.getElementById("problem-select");
  const problems = data.problems || [];
  const signature = problems.map((item) => `${item.displayId}:${item.title}`).join("|");
  if (signature !== problemSignature) {
    const previous = select.value;
    select.textContent = "";
    for (const problem of problems) {
      const option = el(
        "option",
        "",
        `${problem.displayId || problem.id} ${problem.title || ""}`.trim()
      );
      option.value = String(problem.displayId || problem.id || "");
      select.appendChild(option);
    }
    problemSignature = signature;
    if (previous && problems.some((item) => String(item.displayId) === previous)) {
      select.value = previous;
    }
  }
}

function renderSetup(data) {
  const startButton = document.getElementById("start-race");
  const joinButton = document.getElementById("join-race");
  const disabled = !data.canRace || !data.loggedIn;
  const busy = raceIsActive(data);
  startButton.disabled = disabled || busy || !(data.problems || []).length;
  joinButton.disabled = disabled || busy;
  const hint = document.getElementById("race-hint");
  if (!data.canRace) {
    hint.textContent = "该实验不是题库，已禁用竞速。";
  } else if (busy) {
    hint.textContent = "当前竞速进行中；请先结束它，再发起或加入新的竞速。";
  } else {
    hint.textContent =
      "实时竞速 15 秒后开始；口令会复制到剪贴板，对手在同一题库粘贴加入。同一时间只能进行一场竞速。";
  }
  if (!document.getElementById("opponent-input").value && data.opponent && data.opponent.username) {
    document.getElementById("opponent-input").value = data.opponent.username;
  }
}

function makeButton(label, className, onClick) {
  const button = el("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function chooseForRace(data, displayId) {
  const select = document.getElementById("problem-select");
  select.value = String(displayId);
  const opponent = document.getElementById("opponent-input");
  if (!opponent.value && data.opponent && data.opponent.username) {
    opponent.value = data.opponent.username;
  }
  document.getElementById("setup-card").scrollIntoView({ behavior: "smooth", block: "start" });
  opponent.focus();
}

function renderProblems(data) {
  const body = document.getElementById("problem-body");
  const empty = document.getElementById("problem-empty");
  body.textContent = "";
  const statusFilter = document.getElementById("filter-status").value;
  const keyword = document.getElementById("filter-keyword").value.trim().toLowerCase();
  const all = data.problems || [];
  const rows = all.filter((problem) => {
    if (statusFilter !== "all" && problem.status !== statusFilter) {
      return false;
    }
    if (
      keyword &&
      !`${problem.displayId || ""} ${problem.title || ""}`.toLowerCase().includes(keyword)
    ) {
      return false;
    }
    return true;
  });
  const stats = data.stats || {};
  const busy = raceIsActive(data);
  document.getElementById("problem-stats").textContent =
    `${stats.total || 0} 题 · 已通过 ${stats.solved || 0} · 未做 ${stats.todo || 0}`;
  empty.hidden = rows.length > 0;

  for (const problem of rows) {
    const tr = el("tr");
    const mark = statusMark(problem.status);
    const statusCell = el("td", "status-col");
    const dot = el("span", mark.className, mark.text);
    dot.title = mark.label;
    statusCell.appendChild(dot);
    tr.appendChild(statusCell);
    tr.appendChild(el("td", "code-cell", problem.displayId || "—"));
    tr.appendChild(el("td", "title-cell", problem.title || ""));
    tr.appendChild(el("td", "muted", problem.difficulty || "—"));

    const opponentCell = el("td", "muted");
    if (problem.opponent) {
      opponentCell.textContent = problem.opponent.accepted
        ? `AC · ${problem.opponent.attempts} 次`
        : `提交 ${problem.opponent.attempts} 次`;
    } else {
      opponentCell.textContent = "—";
    }
    tr.appendChild(opponentCell);

    const actions = el("td", "actions-cell");
    const raceButton = makeButton("竞速", "btn small", () =>
      chooseForRace(data, problem.displayId)
    );
    raceButton.disabled = !data.canRace || !data.loggedIn || busy;
    actions.appendChild(raceButton);
    actions.appendChild(
      makeButton("开刷", "btn ghost small", () =>
        post("startProblem", { id: problem.displayId })
      )
    );
    actions.appendChild(
      makeButton("题面", "btn ghost small", () =>
        post("openProblem", { id: problem.displayId })
      )
    );
    tr.appendChild(actions);
    body.appendChild(tr);
  }
}

function renderOpponent(data) {
  const panel = document.getElementById("opponent-panel");
  panel.textContent = "";
  const opponent = data.opponent || {};
  if (opponent.loading) {
    panel.appendChild(el("p", "muted", `正在读取 ${opponent.username || "对手"} 的题库提交…`));
    return;
  }
  if (opponent.error) {
    panel.appendChild(el("p", "error-line", opponent.error));
  }
  if (!opponent.username) {
    panel.appendChild(
      el("p", "muted", "输入用户名，查看对方在这个题库里做过哪些题。")
    );
    return;
  }
  if (!opponent.problems || !opponent.problems.length) {
    panel.appendChild(
      el("p", "muted", `${opponent.username} 在这个题库里还没有可公开的提交记录。`)
    );
    return;
  }
  const summary = el("div", "opponent-summary");
  const addStat = (label, value) => {
    const item = el("span");
    item.appendChild(el("strong", "", value));
    item.appendChild(document.createTextNode(` ${label}`));
    summary.appendChild(item);
  };
  addStat("已通过", opponent.solvedCount || 0);
  addStat("尝试未过", opponent.attemptedOnlyCount || 0);
  addStat("近期提交", opponent.submissionCount || 0);
  panel.appendChild(summary);
  if (opponent.truncated) {
    panel.appendChild(el("p", "muted", "只统计了最近的部分提交。"));
  }
  const list = el("div", "opponent-list");
  for (const problem of opponent.problems) {
    const item = el("div", "opponent-item");
    const main = el("div", "opponent-item-main");
    main.appendChild(
      el("div", "opponent-item-title", `${problem.displayId} ${problem.title || ""}`.trim())
    );
    const latest = problem.latestAt ? ` · 最近 ${formatDate(problem.latestAt)}` : "";
    main.appendChild(
      el(
        "div",
        "opponent-item-meta",
        `${problem.accepted ? "已 AC" : "未 AC"} · ${problem.attempts} 次提交${latest}`
      )
    );
    item.appendChild(main);
    list.appendChild(item);
  }
  panel.appendChild(list);
}

function renderRace(data) {
  const card = document.getElementById("active-race-card");
  const host = document.getElementById("active-race");
  host.textContent = "";
  const race = data.race && data.race.active;
  card.hidden = !race;
  if (!race) {
    return;
  }
  const container = el("div", "race-card");
  const head = el("div", "race-head");
  const headText = el("div");
  headText.appendChild(el("div", "race-title", `实时竞速 · ${race.problem.displayId} ${race.problem.title || ""}`.trim()));
  const sub = el(
    "div",
    "race-sub",
    `${raceStatusText(race)} · 开始 ${formatDate(race.startAt)} · 截止 ${formatDate(race.deadlineAt)}`
  );
  headText.appendChild(sub);
  if (race.lastPollError) {
    headText.appendChild(el("div", "error-line", race.lastPollError));
  }
  head.appendChild(headText);
  const clock = el("div", "race-clock", "00:00");
  clock.dataset.clock = "1";
  head.appendChild(clock);
  container.appendChild(head);

  const participants = el("div", "race-participants");
  for (const participant of race.participants || []) {
    const item = el("div", `race-participant${participant.isMe ? " me" : ""}`);
    item.appendChild(el("strong", "", participant.username + (participant.isMe ? "（我）" : "")));
    let text = "等待中";
    if (participant.acceptedAt) {
      text = `已 AC · ${formatDate(participant.acceptedAt)}`;
    } else if (participant.submissions) {
      text = `${participant.submissions} 次提交`;
    }
    item.appendChild(el("div", "muted", text));
    participants.appendChild(item);
  }
  container.appendChild(participants);

  if (race.status === "finished") {
    const resultClass = race.noWinner
      ? ""
      : race.tie
        ? "tie"
        : race.winner === data.me
          ? "win"
          : "loss";
    container.appendChild(el("div", `race-banner ${resultClass}`.trim(), raceStatusText(race)));
  }

  if (race.token) {
    const row = el("div", "token-row");
    const input = document.createElement("input");
    input.type = "text";
    input.readOnly = true;
    input.value = race.token;
    input.id = "race-token";
    row.appendChild(input);
    row.appendChild(
      makeButton("复制口令", "btn ghost small", () => post("copyRaceToken", { token: race.token }))
    );
    container.appendChild(row);
  }

  if (race.events && race.events.length) {
    const list = el("ul", "race-event-list");
    for (const event of race.events.slice(-8).reverse()) {
      const item = el("li");
      item.appendChild(el("span", "", formatDate(event.createdAt)));
      item.appendChild(el("span", "", `${event.username} ${event.resultKey}`));
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  const actions = el("div", "race-actions");
  if (!["finished", "cancelled", "expired"].includes(race.status)) {
    actions.appendChild(
      makeButton("结束竞速", "btn ghost small", () => post("cancelRace"))
    );
  }
  if (actions.childNodes.length) {
    container.appendChild(actions);
  }
  host.appendChild(container);
  updateClock();
}

function renderHistory(data) {
  const panel = document.getElementById("history-panel");
  panel.textContent = "";
  const history = data.history || [];
  document.getElementById("history-count").textContent = history.length
    ? `${history.length} 场`
    : "";
  if (!history.length) {
    panel.appendChild(el("p", "muted", "还没有竞速记录。"));
    return;
  }
  for (const entry of history) {
    const item = el("div", "history-item");
    const main = el("div", "history-main");
    main.appendChild(
      el(
        "div",
        "history-title",
        `${entry.problem.displayId} ${entry.problem.title || ""}`.trim()
      )
    );
    const opponents = (entry.opponents || []).join("、") || "—";
    main.appendChild(
      el(
        "div",
        "history-meta",
        `实时竞速 · 对手 ${opponents} · ${formatDate(entry.finishedAt)} · ${entry.submissions || 0} 次提交`
      )
    );
    item.appendChild(main);
    const labels = { win: "胜", loss: "负", tie: "平", none: "完成" };
    const className = entry.result === "win" || entry.result === "loss" || entry.result === "tie"
      ? `result-badge ${entry.result}`
      : "result-badge";
    item.appendChild(el("span", className, labels[entry.result] || "完成"));
    panel.appendChild(item);
  }
}

function updateClock() {
  if (!current || !current.race || !current.race.active) {
    return;
  }
  const race = current.race.active;
  const clock = document.querySelector("[data-clock]");
  if (!clock) {
    return;
  }
  const now = Date.now();
  const start = Date.parse(race.startAt);
  const deadline = Date.parse(race.deadlineAt);
  if (race.status === "armed" && Number.isFinite(start) && now < start) {
    clock.textContent = `开始 ${formatClock(start - now)}`;
  } else if (race.status === "finished" || race.status === "cancelled" || race.status === "expired") {
    clock.textContent = "已结束";
  } else if (Number.isFinite(deadline)) {
    clock.textContent = formatClock(deadline - now);
  }
}

function renderAll() {
  if (!current) {
    return;
  }
  preserveFocus(() => {
    renderHeader(current);
    renderWarning(current);
    renderProblemOptions(current);
    renderSetup(current);
    renderProblems(current);
    renderOpponent(current);
    renderRace(current);
    renderHistory(current);
  });
}

function wireEvents() {
  document.getElementById("btn-refresh").addEventListener("click", () => post("refresh"));

  document.getElementById("start-race").addEventListener("click", () => {
    if (startPending) {
      return;
    }
    const select = document.getElementById("problem-select");
    const problemId = select.value;
    if (!problemId) {
      showToast("warn", "请先选择一道题");
      return;
    }
    startPending = true;
    setTimeout(() => {
      startPending = false;
    }, 2000);
    post("startRace", {
      problemId,
      opponent: document.getElementById("opponent-input").value.trim(),
      durationSec: Number(document.getElementById("duration-select").value)
    });
  });

  document.getElementById("join-race").addEventListener("click", () => {
    if (joinPending) {
      return;
    }
    const input = document.getElementById("token-input");
    const token = input.value.trim();
    if (!token) {
      showToast("warn", "请先粘贴竞速口令");
      return;
    }
    joinPending = true;
    setTimeout(() => {
      joinPending = false;
    }, 2000);
    post("joinRace", { token });
    input.value = "";
  });

  document.getElementById("btn-opponent").addEventListener("click", () => {
    const username = document.getElementById("opponent-query").value.trim();
    if (!username) {
      showToast("warn", "请输入对手用户名");
      return;
    }
    post("loadOpponent", { username });
  });

  document.getElementById("opponent-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("btn-opponent").click();
    }
  });

  document.getElementById("opponent-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("start-race").click();
    }
  });

  document.getElementById("filter-status").addEventListener("change", () => {
    if (current) {
      renderProblems(current);
    }
  });

  document.getElementById("filter-keyword").addEventListener("input", () => {
    if (current) {
      renderProblems(current);
    }
  });

  document.addEventListener("visibilitychange", () => {
    post("visibility", { visible: !document.hidden });
  });
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "state") {
    current = message.data;
    renderAll();
  } else if (message.type === "toast") {
    showToast(message.level, message.message);
  }
});

wireEvents();
post("ready");
setInterval(updateClock, 500);
