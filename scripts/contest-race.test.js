/**
 * 题库竞速：题库识别、/api/contest_submissions、影子基线与跨题库拒绝。
 */
"use strict";

const assert = require("assert");
const path = require("path");
const Module = require("module");

// ---- vscode mock ----------------------------------------------------------
const repoRoot = path.join(__dirname, "..");
const warnings = [];
const panels = [];

function makePanel(title) {
  const messages = [];
  const panel = {
    title: String(title || ""),
    messages,
    webview: {
      html: "",
      cspSource: "vscode-webview:",
      asWebviewUri: (uri) => uri,
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: async (message) => {
        messages.push(message);
        return true;
      }
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
    reveal() {},
    dispose() {}
  };
  panels.push(panel);
  return panel;
}

const vscode = {
  ViewColumn: { Active: -1, One: 1, Two: 2 },
  Uri: {
    file(p) {
      return { scheme: "file", fsPath: p, path: p, toString: () => `file://${p}` };
    },
    joinPath(base, ...parts) {
      const head = base && base.fsPath ? base.fsPath : String(base);
      return vscode.Uri.file([head].concat(parts.map(String)).join("/"));
    }
  },
  window: {
    createWebviewPanel: (viewType, title) => makePanel(title),
    showWarningMessage: (message) => {
      warnings.push(message);
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key === "race.pollIntervalSeconds" ? 10 : fallback)
    })
  },
  env: {
    clipboard: {
      writeText: async () => true
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ContestRaceWorkbench, RECORDS_KEY } = require("../src/contestRaceWorkbench");
const { isQuestionBankContest, createSiteApi } = require("../src/siteApi");
const raceLib = require("../src/problemsetRace");

// ---- fixtures -------------------------------------------------------------
const BASE = "https://xmuoj.test";
const COURSE_TITLE = "[教材] 程序设计基础";

const contest = {
  id: 9001,
  title: COURSE_TITLE,
  status: "hidden",
  rule_type: "OI",
  real_time_rank: false
};

const exam = {
  id: 7001,
  title: "期中考试",
  is_exam: true
};

const problems = [
  { id: 101, _id: "PTA1.1", title: "求两数之和", difficulty: "Low" },
  { id: 102, _id: "PTA1.2", title: "求平均数", difficulty: "Low" }
];

const submission = (id, problem, result, createTime) => ({
  id,
  username: "bob",
  problem,
  result,
  create_time: createTime,
  contest_id: 9001,
  language: "C++",
  statistic_info: { time_cost: 8 }
});

const requests = [];

function fakeRequest(pathname) {
  requests.push(pathname);
  const parsed = new URL(pathname, BASE);
  if (parsed.pathname === "/api/contest_submissions") {
    const problem = parsed.searchParams.get("problem_id");
    const username = parsed.searchParams.get("username");
    let results = [];
    if (username === "bob" && problem === "PTA1.1") {
      results = [
        submission("b1", "PTA1.1", -1, "2026-10-20T10:00:00"),
        submission("b2", "PTA1.1", 0, "2026-10-20T10:05:00")
      ];
    } else if (username === "bob" && !problem) {
      results = [
        submission("b2", "PTA1.1", 0, "2026-10-20T10:05:00"),
        submission("b3", "PTA1.2", -1, "2026-10-20T10:10:00")
      ];
    }
    return Promise.resolve({ total: results.length, results });
  }
  return Promise.reject(new Error(`unexpected path ${pathname}`));
}

const client = { baseUrl: BASE, request: fakeRequest };

// ---- harness --------------------------------------------------------------
let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

function lastState(panel) {
  return panel.messages.filter((message) => message.type === "state").pop();
}

function lastToast(panel) {
  return panel.messages.filter((message) => message.type === "toast").pop();
}

async function main() {
  console.log("contest race");

  await check("题库识别：教材题库放行，实验/考试拒绝", () => {
    assert.strictEqual(isQuestionBankContest({ title: COURSE_TITLE }), true);
    assert.strictEqual(isQuestionBankContest({ title: "【教材】算法设计" }), true);
    assert.strictEqual(isQuestionBankContest({ is_question_bank: true, title: "任意" }), true);
    assert.strictEqual(isQuestionBankContest(exam), false);
    assert.strictEqual(
      isQuestionBankContest({ title: "程序设计实验", is_question_bank: true, is_exam: true }),
      false,
      "考试即使带题库标记也不能竞速"
    );
    assert.strictEqual(isQuestionBankContest({ title: "第一次实验" }), false);
  });

  await check("getContestSubmissions 只走 /api/contest_submissions 并带实验 id", async () => {
    const api = createSiteApi(client);
    const page = await api.getContestSubmissions({
      contestId: 9001,
      username: "bob",
      problemId: "PTA1.1",
      limit: 10
    });
    assert.strictEqual(page.total, 2);
    assert.deepStrictEqual(page.results.map((item) => item.resultKey), ["WA", "AC"]);
    assert.strictEqual(page.results[0].contestId, 9001);
    const used = requests[requests.length - 1];
    assert.ok(used.startsWith("/api/contest_submissions?"));
    assert.ok(used.includes("contest_id=9001"));
    assert.ok(used.includes("problem_id=PTA1.1"));
    assert.ok(used.includes("username=bob"));
  });

  const context = {
    globalState: {
      store: new Map(),
      get(key, fallback) {
        return this.store.has(key) ? this.store.get(key) : fallback;
      },
      async update(key, value) {
        this.store.set(key, value);
      }
    },
    extensionUri: { fsPath: repoRoot },
    extensionPath: repoRoot
  };

  const workbench = new ContestRaceWorkbench({
    context,
    state: {},
    actions: {
      getClient: () => client,
      getBaseUrl: () => BASE,
      getUsername: () => "alice"
    }
  });

  await check("考试实验拒绝打开竞速面板", async () => {
    await workbench.open({ contest: exam, problems, baseUrl: BASE });
    assert.strictEqual(panels.length, 0, "考试不应创建面板");
    assert.ok(warnings.some((message) => message.includes("考试")));
  });

  await check("题库实验打开面板并渲染题目状态", async () => {
    await workbench.open({
      contest,
      problems: problems.map((problem, index) => ({
        ...problem,
        my_status: index === 0 ? 0 : 1
      })),
      baseUrl: BASE,
      contestPassword: "secret"
    });
    assert.strictEqual(panels.length, 1);
    const panel = panels[0];
    assert.ok(panel.title.includes("题库竞速"));
    assert.ok(panel.webview.html.includes("contestrace/app.js"));
    const state = lastState(panel);
    assert.strictEqual(state.data.canRace, true);
    assert.strictEqual(state.data.problems.length, 2);
    assert.strictEqual(state.data.problems[0].status, "solved");
    assert.strictEqual(state.data.problems[1].status, "attempted");
    assert.strictEqual(state.data.warning, "");
  });

  await check("实时竞速：创建口令并忽略旧影子参数", async () => {
    const panel = panels[0];
    requests.length = 0;
    await workbench.handleMessage({
      type: "startRace",
      problemId: "PTA1.1",
      opponent: "bob",
      mode: "shadow",
      durationSec: 900
    });
    const state = lastState(panel);
    assert.ok(state.data.race.active, "应有活跃竞速");
    assert.strictEqual(state.data.race.active.mode, "live");
    assert.strictEqual(state.data.race.active.contest.id, 9001);
    assert.strictEqual(state.data.race.active.shadow, undefined);
    assert.ok(state.data.race.active.token.startsWith("XMJ1."));
    assert.deepStrictEqual(
      state.data.race.active.participants.map((item) => item.username),
      ["alice", "bob"]
    );
    assert.strictEqual(requests.length, 0, "创建实时竞速不应读取提交");
    workbench._clearRaceTimer();
  });

  await check("同一时间只允许一场：再次发起被拒绝", async () => {
    const panel = panels[0];
    const before = lastState(panel).data.race.active;
    await workbench.handleMessage({
      type: "startRace",
      problemId: "PTA1.2",
      opponent: "bob",
      durationSec: 900
    });
    const toast = lastToast(panel);
    assert.ok(toast && toast.level === "warn");
    assert.ok(toast.message.includes("未结束"));
    assert.strictEqual(lastState(panel).data.race.active.id, before.id, "不能替换现有竞速");
    workbench._clearRaceTimer();
  });

  await check("其他题库有活跃竞速时拒绝切换面板", async () => {
    const before = panels.length;
    await workbench.open({
      contest: { id: 9002, title: "[教材] 另一个题库", is_question_bank: true },
      problems,
      baseUrl: BASE
    });
    assert.strictEqual(panels.length, before, "不应创建或替换面板");
    assert.ok(warnings.some((message) => message.includes("未结束")));
  });

  await check("同一时间只允许一场：竞速中拒绝加入另一场", async () => {
    const panel = panels[0];
    const another = raceLib.createRaceRecord({
      contest: { id: 9001, title: "[教材] 程序设计基础", isQuestionBank: true },
      problem: { displayId: "PTA1.1", title: "求两数之和" },
      host: "carol",
      participants: ["carol"],
      now: "2026-10-20T10:00:00Z",
      startAt: "2099-10-20T10:01:00Z",
      deadlineAt: "2099-10-20T11:00:00Z"
    });
    const before = lastState(panel).data.race.active;
    await workbench.handleMessage({
      type: "joinRace",
      token: raceLib.raceToToken(another)
    });
    const toast = lastToast(panel);
    assert.ok(toast && toast.level === "warn");
    assert.ok(toast.message.includes("未结束"));
    assert.strictEqual(lastState(panel).data.race.active.id, before.id);
  });

  await check("跨题库口令被拒绝", async () => {
    const panel = panels[0];
    const foreign = raceLib.createRaceRecord({
      mode: "live",
      contest: { id: 9999, title: "别的题库", isQuestionBank: true },
      problem: { displayId: "PTA1.1", title: "求两数之和" },
      host: "carol",
      participants: ["carol"],
      now: "2026-10-20T10:00:00Z",
      startAt: "2026-10-20T10:01:00Z",
      deadlineAt: "2026-10-20T11:00:00Z"
    });
    await workbench.handleMessage({
      type: "joinRace",
      token: raceLib.raceToToken(foreign)
    });
    const toast = lastToast(panel);
    assert.ok(toast && toast.level === "error");
    assert.ok(toast.message.includes("另一个题库"));
    assert.strictEqual(lastState(panel).data.race.active.contest.id, 9001, "原竞速不应被替换");
  });

  await check("提交回调：更新题库内本人状态", () => {
    const panel = panels[0];
    workbench.noteMySubmission({
      contestId: 9001,
      displayId: "PTA1.2",
      accepted: true,
      submissionId: "a1",
      createdAt: "2026-10-20T11:00:00"
    });
    const state = lastState(panel);
    const item = state.data.problems.find((problem) => problem.displayId === "PTA1.2");
    assert.strictEqual(item.status, "solved");
    workbench._clearRaceTimer();
  });

  await check("竞速记录按题库隔离持久化", async () => {
    await workbench.cancelRace();
    const stored = context.globalState.store.get(RECORDS_KEY);
    assert.ok(stored, "应写入竞速记录");
    const keys = Object.keys(stored);
    assert.strictEqual(keys.length, 1);
    const scoped = stored[keys[0]];
    assert.strictEqual(scoped.active, null);
    assert.ok(scoped.history.length >= 1, "取消后应进入历史");
  });

  await check("结束当前竞速后可以重新发起", async () => {
    const panel = panels[0];
    await workbench.startRace({ problemId: "PTA1.2", opponent: "bob", durationSec: 600 });
    const active = lastState(panel).data.race.active;
    assert.ok(active, "结束后应能再次发起");
    assert.strictEqual(active.problem.displayId, "PTA1.2");
    await workbench.cancelRace();
  });

  await check("启动整理：清空影子历史与残留活跃影子竞速", () => {
    const legacyContext = {
      globalState: {
        store: new Map([
          [
            RECORDS_KEY,
            {
              abc: {
                active: {
                  id: "race_shadow",
                  mode: "shadow",
                  status: "running",
                  contest: { id: 9001, title: "题库" },
                  problem: { displayId: "PTA1.1", title: "题" },
                  participants: [{ username: "alice", acceptedAt: null, submissions: [] }],
                  events: [],
                  startAt: "2026-10-20T10:00:00Z",
                  deadlineAt: "2026-10-20T11:00:00Z",
                  createdAt: "2026-10-20T09:59:00Z",
                  updatedAt: "2026-10-20T09:59:00Z"
                },
                history: [
                  {
                    id: "h_shadow",
                    mode: "shadow",
                    problem: { displayId: "PTA1.1", title: "题" },
                    opponents: [],
                    finishedAt: "2026-10-20T10:10:00Z",
                    submissions: 2
                  },
                  {
                    id: "h_live",
                    mode: "live",
                    problem: { displayId: "PTA1.2", title: "题2" },
                    opponents: ["bob"],
                    finishedAt: "2026-10-20T10:20:00Z",
                    submissions: 1
                  }
                ]
              }
            }
          ]
        ]),
        get(key, fallback) {
          return this.store.has(key) ? this.store.get(key) : fallback;
        },
        async update(key, value) {
          this.store.set(key, value);
        }
      },
      extensionUri: { fsPath: repoRoot },
      extensionPath: repoRoot
    };
    const legacy = new ContestRaceWorkbench({
      context: legacyContext,
      state: {},
      actions: { getUsername: () => "alice" }
    });
    const stored = legacyContext.globalState.store.get(RECORDS_KEY);
    assert.strictEqual(stored.abc.active, null, "残留影子竞速应被清除");
    assert.deepStrictEqual(
      stored.abc.history.map((item) => item.id),
      ["h_live"],
      "影子历史应被清空，实时历史保留"
    );
    legacy.dispose();
  });

  workbench.dispose();
  console.log(`contest race OK（${passed} 项）`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
