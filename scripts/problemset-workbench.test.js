/**
 * 刷题台控制器集成测试：mock vscode 与站点 API，走完整加载/队列/关注链路。
 */
"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const Module = require("module");

// ---- vscode mock ----------------------------------------------------------
const repoRoot = path.join(__dirname, "..");
const panelMessages = [];
const store = new Map();

class Disposable {
  constructor(fn) {
    this.fn = typeof fn === "function" ? fn : null;
  }
  dispose() {
    if (this.fn) {
      this.fn();
    }
  }
}

const panel = {
  title: "",
  webview: {
    html: "",
    cspSource: "vscode-webview:",
    asWebviewUri: (uri) => uri,
    onDidReceiveMessage: () => new Disposable(),
    postMessage: async (message) => {
      panelMessages.push(message);
      return true;
    }
  },
  onDidChangeViewState: () => new Disposable(),
  onDidDispose: () => new Disposable(),
  reveal() {},
  dispose() {}
};

const vscode = {
  ViewColumn: { Active: -1, One: 1, Two: 2 },
  Uri: {
    file(p) {
      return { scheme: "file", fsPath: p, path: p, toString: () => `file://${p}` };
    },
    joinPath(base, ...parts) {
      const pieces = [base && base.fsPath ? base.fsPath : String(base)].concat(parts.map(String));
      return vscode.Uri.file(pieces.join("/"));
    }
  },
  window: {
    createWebviewPanel: () => panel
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => fallback
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

const { ProblemsetWorkbench } = require("../src/problemsetWorkbench");

// ---- fixtures -------------------------------------------------------------
const BASE = "https://xmuoj.test";

function url(pathname) {
  return new URL(pathname, BASE);
}

function page(results, total, offset) {
  return { results, total, offset };
}

const profile = {
  username: "alice",
  accepted_number: 1,
  submission_number: 3,
  total_score: 100,
  acm_problems_status: {
    problems: {
      11: { _id: "GW001", status: 0 },
      12: { _id: "GW002", status: -1 }
    }
  }
};

const problems = [
  { id: 11, _id: "GW001", title: "输出第二个整数", difficulty: "Low", tags: ["数学"], accepted_number: 6, submission_number: 10 },
  { id: 12, _id: "GW002", title: "区间求和", difficulty: "Mid", tags: ["前缀和"], accepted_number: 3, submission_number: 12 },
  { id: 13, _id: "GW003", title: "最长上升子序列", difficulty: "High", tags: ["dp"], accepted_number: 1, submission_number: 20 }
];

function submission(id, username, problemId, result, createTime) {
  return {
    id,
    username,
    problem: problemId,
    result,
    create_time: createTime,
    language: "C++",
    statistic_info: { time_cost: 12 }
  };
}

const submissions = {
  alice: [
    submission("a2", "alice", "GW001", 0, "2026-10-20T10:30:00"),
    submission("a1", "alice", "GW002", -1, "2026-10-20T10:00:00")
  ],
  bob: [
    submission("b2", "bob", "GW001", 0, "2026-10-20T10:05:00"),
    submission("b1", "bob", "GW001", -1, "2026-10-20T10:00:00")
  ]
};

function fakeRequest(pathname) {
  const parsed = url(pathname);
  const query = parsed.searchParams;
  if (parsed.pathname === "/api/profile") {
    const username = query.get("username");
    if (!username || username === "alice") {
      return Promise.resolve(profile);
    }
    if (username === "bob") {
      return Promise.resolve({ username: "bob", accepted_number: 4, submission_number: 9, total_score: 400 });
    }
    return Promise.resolve(null);
  }
  if (parsed.pathname === "/api/problem") {
    const offset = Number(query.get("offset") || 0);
    const limit = Number(query.get("limit") || 200);
    return Promise.resolve(page(problems.slice(offset, offset + limit), problems.length, offset));
  }
  if (parsed.pathname === "/api/user_rank") {
    return Promise.resolve({
      total: 3,
      results: [
        { user: { username: "alice" }, accepted_number: 5, submission_number: 10, total_score: 500 },
        { user: { username: "bob" }, accepted_number: 4, submission_number: 9, total_score: 400 },
        { user: { username: "carol" }, accepted_number: 2, submission_number: 6, total_score: 200 }
      ]
    });
  }
  if (parsed.pathname === "/api/submissions") {
    const username = query.get("username") || "";
    const list = username
      ? submissions[username] || []
      : Object.values(submissions).flat();
    const problemId = query.get("problem_id");
    const result = query.get("result");
    const filtered = list.filter(
      (item) =>
        (!problemId || item.problem === problemId) &&
        (result === null || String(item.result) === result)
    );
    const offset = Number(query.get("offset") || 0);
    const limit = Number(query.get("limit") || 50);
    return Promise.resolve(
      page(filtered.slice(offset, offset + limit), filtered.length, offset)
    );
  }
  if (parsed.pathname === "/api/profile/contests") {
    return Promise.resolve(
      page(
        [{ contest_id: 7, contest_title: "第一次实验", ac_count: 2, total_score: 200 }],
        1,
        0
      )
    );
  }
  if (parsed.pathname === "/api/profile/contest_detail") {
    return Promise.resolve({ problem_items: [] });
  }
  return Promise.reject(new Error(`unexpected path ${pathname}`));
}

const fakeClient = {
  baseUrl: BASE,
  request: fakeRequest,
  getProblemset: async () => ({ results: [], count: 0 })
};

// ---- harness --------------------------------------------------------------
let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok ${name}`);
    })
    .catch((error) => {
      console.error(`  FAIL ${name}`);
      throw error;
    });
}

function snapshots(slice) {
  return panelMessages.filter((message) => message.type === "snapshot" && message.slice === slice);
}

function lastSnapshot(slice) {
  const list = snapshots(slice);
  return list[list.length - 1];
}

async function main() {
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-workbench-"));
  const context = {
    globalState: {
      get: (key, fallback) => (store.has(key) ? store.get(key) : fallback),
      update: async (key, value) => {
        store.set(key, value);
      }
    },
    globalStorageUri: { fsPath: storageRoot },
    extensionUri: { fsPath: repoRoot },
    extensionPath: repoRoot
  };
  const state = { problemsetSelections: [], activeProblem: null };
  const workbench = new ProblemsetWorkbench({
    context,
    state,
    actions: {
      getClient: () => fakeClient,
      getUsername: () => "alice",
      openProblem: async () => undefined,
      startProblem: async () => undefined,
      openOnline: async () => undefined,
      persistQueue: async () => undefined,
      refreshTree: () => undefined,
      login: async () => undefined
    }
  });

  console.log("problemset workbench");

  try {
    await workbench.open();

    await check("打开面板：加载题目目录与个人状态", () => {
      const snapshot = lastSnapshot("problems");
      assert.ok(snapshot, "应有 problems 快照");
      assert.strictEqual(snapshot.data.stats.total, 3);
      assert.strictEqual(snapshot.data.stats.solved, 1);
      assert.strictEqual(snapshot.data.stats.attempted, 1);
      assert.strictEqual(snapshot.data.stats.todo, 1);
      const gw001 = snapshot.data.items.find((item) => item.displayId === "GW001");
      assert.strictEqual(gw001.status, "solved");
      assert.strictEqual(gw001.statusSource, "server");
    });

    await check("概览：用户名、排名与最近提交", () => {
      const snapshot = lastSnapshot("overview");
      assert.strictEqual(snapshot.data.profile.username, "alice");
      assert.strictEqual(snapshot.data.rank.status, "ranked");
      assert.strictEqual(snapshot.data.rank.rank, 1);
      assert.strictEqual(snapshot.data.recentSubmissions.length, 2);
    });

    await check("排行：Top 50 与关注标记", () => {
      const snapshot = lastSnapshot("ranking");
      assert.strictEqual(snapshot.data.rows.length, 3);
      assert.strictEqual(snapshot.data.rows[0].username, "alice");
      assert.strictEqual(snapshot.data.total, 3);
    });

    await check("队列：加入原位、置顶与移除", async () => {
      await workbench.handleMessage({ type: "addQueue", id: "GW002" });
      await workbench.handleMessage({ type: "addQueue", id: "GW001" });
      assert.deepStrictEqual(
        state.problemsetSelections.map((item) => item.display_id),
        ["GW002", "GW001"]
      );
      await workbench.handleMessage({ type: "addQueue", id: "GW002" });
      assert.deepStrictEqual(
        state.problemsetSelections.map((item) => item.display_id),
        ["GW002", "GW001"],
        "已存在时应原位更新而不是移到队尾"
      );
      await workbench.handleMessage({ type: "queueToTop", id: "GW001" });
      assert.deepStrictEqual(
        state.problemsetSelections.map((item) => item.display_id),
        ["GW001", "GW002"]
      );
      await workbench.handleMessage({ type: "removeQueue", id: "GW002" });
      assert.deepStrictEqual(state.problemsetSelections.map((item) => item.display_id), ["GW001"]);
    });

    await check("关注：持久化并加载最近提交", async () => {
      await workbench.handleMessage({ type: "follow", username: "bob" });
      await workbench.loadFollowDetails({ force: true });
      assert.deepStrictEqual(store.get("xmuoj.followedUsers"), ["bob"]);
      const snapshot = lastSnapshot("following");
      const bob = snapshot.data.users.find((user) => user.username === "bob");
      assert.ok(bob);
      assert.strictEqual(bob.acceptedNumber, 4);
      assert.strictEqual(bob.recentSubmission.resultKey, "AC");
      await workbench.handleMessage({ type: "unfollow", username: "bob" });
      assert.deepStrictEqual(store.get("xmuoj.followedUsers"), []);
    });

    await check("资料抽屉：对手公开数据", async () => {
      await workbench.handleMessage({ type: "openProfile", username: "bob" });
      const snapshot = lastSnapshot("followProfile");
      assert.strictEqual(snapshot.data.username, "bob");
      assert.strictEqual(snapshot.data.found, true);
      assert.strictEqual(snapshot.data.recentSubmissions.length, 2);
    });

    await check("提交回调：AC 后立即更新状态", () => {
      workbench.noteMySubmission({
        problemId: 13,
        displayId: "GW003",
        accepted: true,
        resultLabel: "Accepted",
        submissionId: "a3",
        createdAt: "2026-10-20T11:00:00"
      });
      const snapshot = lastSnapshot("problems");
      const gw003 = snapshot.data.items.find((item) => item.displayId === "GW003");
      assert.strictEqual(gw003.status, "solved");
      assert.strictEqual(snapshot.data.stats.solved, 2);
    });

    await check("刷新后 UI 状态持久化", async () => {
      await workbench.handleMessage({
        type: "persistUi",
        ui: {
          tab: "ranking",
          filters: { status: "todo", difficulty: "High", tag: "dp", keyword: "上升" },
          sort: "difficulty",
          page: 2,
          pageSize: 25,
          rankRule: "oi"
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 320));
      const saved = store.get("xmuoj.problemsetWorkbench.ui");
      assert.strictEqual(saved.tab, "ranking");
      assert.strictEqual(saved.filters.keyword, "上升");
      assert.strictEqual(saved.pageSize, 25);
      assert.strictEqual(saved.rankRule, "oi");
    });

    await check("题库排序：提交数与通过率会改变快照顺序", async () => {
      await workbench.handleMessage({
        type: "persistUi",
        ui: {
          sort: "submissions",
          page: 1,
          pageSize: 50,
          filters: { status: "all", difficulty: "all", tag: "all", keyword: "" }
        }
      });
      assert.strictEqual(lastSnapshot("problems").data.sort, "submissions");
      assert.deepStrictEqual(
        lastSnapshot("problems").data.items.map((item) => item.displayId),
        ["GW003", "GW002", "GW001"],
        "按提交数应从多到少"
      );

      await workbench.handleMessage({
        type: "persistUi",
        ui: {
          sort: "passRate",
          page: 1,
          pageSize: 50,
          filters: { status: "all", difficulty: "all", tag: "all", keyword: "" }
        }
      });
      assert.strictEqual(lastSnapshot("problems").data.sort, "passRate");
      assert.deepStrictEqual(
        lastSnapshot("problems").data.items.map((item) => item.displayId),
        ["GW001", "GW002", "GW003"],
        "按通过率应从高到低"
      );
    });

    await check("本题榜单：按最早 AC 排序并统计最近提交", async () => {
      await workbench.handleMessage({ type: "loadProblemBoard", problemId: "GW001" });
      const snapshot = lastSnapshot("problemBoard");
      assert.strictEqual(snapshot.data.displayId, "GW001");
      assert.strictEqual(snapshot.data.problem.title, "输出第二个整数");
      assert.strictEqual(snapshot.data.submissionTotal, 3);
      assert.strictEqual(snapshot.data.acTotal, 2);
      assert.deepStrictEqual(
        snapshot.data.rows.map((row) => row.username),
        ["bob", "alice"]
      );
      assert.strictEqual(snapshot.data.recent.length, 3);
      assert.strictEqual(snapshot.data.passRate, 66.7);
      assert.strictEqual(snapshot.data.speedAvailable, true);
      assert.deepStrictEqual(
        snapshot.data.fastest.map((row) => [row.username, row.durationMs, row.attempts]),
        [
          ["alice", 0, 1],
          ["bob", 300000, 2]
        ],
        "最快通过用时来自本题完整提交记录"
      );
      assert.deepStrictEqual(
        snapshot.data.mostAccepted.map((row) => row.username),
        ["bob", "alice"]
      );
    });
  } finally {
    workbench.dispose();
    Module._load = originalLoad;
    await fs.rm(storageRoot, { recursive: true, force: true }).catch(() => null);
  }

  console.log(`problemset workbench OK（${passed} 项）`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("problemset workbench FAILED：", error && error.stack ? error.stack : error);
    process.exit(1);
  });
