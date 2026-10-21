/**
 * XMUOJ 站点（Django）API 的包装与归一化。
 *
 * 这些接口是站点网页自己在用的公开接口，不是插件专用契约。所有字段访问都必须
 * 容错；归一化后插件内部只认 id（数字/字符串主键）与 displayId（GW001 这类展示号）。
 */
"use strict";

const JUDGE_STATUS = Object.freeze({
  0: "AC",
  "-1": "WA",
  "-2": "CE",
  1: "TLE",
  2: "TLE",
  3: "MLE",
  4: "RE",
  5: "SE",
  6: "Pending",
  7: "Judging",
  8: "Partial",
  9: "Submitting"
});

const RESULT_LABELS = Object.freeze({
  AC: "Accepted",
  WA: "Wrong Answer",
  CE: "Compile Error",
  TLE: "Time Limit Exceeded",
  MLE: "Memory Limit Exceeded",
  RE: "Runtime Error",
  SE: "System Error",
  Pending: "Pending",
  Judging: "Judging",
  Partial: "Partial Accepted",
  Submitting: "Submitting",
  Unknown: "Unknown"
});

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

/** 把 Django 常见的无时区 UTC 字符串补成可解析的 ISO 时间。 */
function parseServerTime(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number") {
    // 站点可能返回秒或毫秒时间戳。
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  let text = String(value).trim();
  if (!text) {
    return null;
  }
  if (/^\d+$/.test(text)) {
    return parseServerTime(Number(text));
  }
  text = text.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    text = `${text}T00:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    text = `${text}Z`;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeResultCode(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function resultKeyFromCode(code) {
  if (code === null || code === undefined) {
    return "Unknown";
  }
  return JUDGE_STATUS[String(code)] || "Unknown";
}

function normalizeProblem(raw, context = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = firstDefined(raw.id, raw.problem_id, raw.pk);
  const displayId = String(
    firstDefined(raw.display_id, raw.displayId, raw._id, raw.problem_id, id, "")
  );
  const numericId = toNumberOrNull(id);
  const solvedSet = context.solvedSet || null;
  const attemptedSet = context.attemptedSet || null;
  const solvedOnServer = Boolean(
    solvedSet &&
      (solvedSet.has(String(id)) ||
        solvedSet.has(displayId) ||
        (numericId !== null && solvedSet.has(String(numericId))))
  );
  const attemptedOnServer = Boolean(
    !solvedOnServer &&
      attemptedSet &&
      (attemptedSet.has(String(id)) ||
        attemptedSet.has(displayId) ||
        (numericId !== null && attemptedSet.has(String(numericId))))
  );
  return {
    id: numericId !== null ? numericId : id,
    displayId,
    title: String(firstDefined(raw.title, raw.name, "")),
    difficulty: String(firstDefined(raw.difficulty, "")),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    source: String(firstDefined(raw.source, raw.contest && raw.contest.title, "")),
    acceptedNumber:
      toNumberOrNull(firstDefined(raw.accepted_number, raw.acceptedNumber)) || 0,
    submissionNumber:
      toNumberOrNull(firstDefined(raw.submission_number, raw.submissionNumber)) || 0,
    solvedOnServer,
    attemptedOnServer,
    raw
  };
}

function normalizeSubmission(raw, context = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const code = normalizeResultCode(raw.result);
  const problem = raw.problem;
  let problemDisplayId = "";
  let problemTitle = "";
  if (problem && typeof problem === "object") {
    problemDisplayId = String(
      firstDefined(problem.display_id, problem._id, problem.id, "")
    );
    problemTitle = String(firstDefined(problem.title, ""));
  } else if (problem !== undefined && problem !== null) {
    problemDisplayId = String(problem);
  }
  const statistic = raw.statistic_info && typeof raw.statistic_info === "object"
    ? raw.statistic_info
    : {};
  return {
    id: firstDefined(raw.id, raw.submission_id, ""),
    username: String(firstDefined(raw.username, (raw.user && raw.user.username) || "", context.username || "")),
    problemDisplayId,
    problemTitle,
    resultCode: code,
    resultKey: resultKeyFromCode(code),
    resultLabel: RESULT_LABELS[resultKeyFromCode(code)] || "Unknown",
    createdAt: parseServerTime(firstDefined(raw.create_time, raw.created_at, raw.createdAt)),
    language: String(firstDefined(raw.language, "")),
    timeCost: toNumberOrNull(statistic.time_cost),
    memoryCost: toNumberOrNull(statistic.memory_cost),
    score: toNumberOrNull(statistic.score),
    shared: Boolean(raw.shared),
    contestId: firstDefined(
      raw.contest_id,
      raw.contestId,
      raw.contest && typeof raw.contest === "object" ? raw.contest.id : undefined,
      context.contestId
    )
  };
}

function truthyFlag(value) {
  if (value === true) {
    return true;
  }
  if (value === false || value === null || value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

/** 实验是考试时绝不启用竞速。 */
function isExamContest(contest) {
  if (!contest || typeof contest !== "object") {
    return false;
  }
  return truthyFlag(contest.is_exam) || truthyFlag(contest.isExam);
}

/**
 * 判断一个实验是否属于“题库”（教材配套题库）。
 *
 * 后台没有统一的题库标记：线上接口可能返回 is_question_bank，本地
 * Course 题库则以隐藏 OI 实验的形式存在，标题固定为 “[教材] 课程名”。
 * 因此同时接受显式标记和标题前缀；考试一律排除。
 */
function isQuestionBankContest(contest) {
  if (!contest || typeof contest !== "object" || isExamContest(contest)) {
    return false;
  }
  if (truthyFlag(contest.is_question_bank) || truthyFlag(contest.isQuestionBank)) {
    return true;
  }
  const title = String(
    firstDefined(contest.title, contest.name, contest.contest_title, "")
  ).trim();
  return title.startsWith("[教材]") || title.startsWith("【教材】");
}

function collectStatusSets(statusContainer, solvedSet, attemptedSet) {
  if (!statusContainer || typeof statusContainer !== "object") {
    return;
  }
  const problems = statusContainer.problems && typeof statusContainer.problems === "object"
    ? statusContainer.problems
    : statusContainer;
  for (const [key, value] of Object.entries(problems)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const identifiers = [key, value._id, value.id, value.display_id, value.displayId]
      .filter((entry) => entry !== undefined && entry !== null && entry !== "")
      .map(String);
    if (!identifiers.length) {
      continue;
    }
    if (Number(value.status) === 0) {
      identifiers.forEach((identifier) => solvedSet.add(identifier));
    } else if (value.status !== undefined && value.status !== null) {
      identifiers.forEach((identifier) => attemptedSet.add(identifier));
    }
  }
}

/** 从 profile 的 ACM/OI 状态表构建已解决/尝试过集合。 */
function buildProfileStatusSets(profile) {
  const solvedSet = new Set();
  const attemptedSet = new Set();
  if (!profile || typeof profile !== "object") {
    return { solvedSet, attemptedSet };
  }
  collectStatusSets(profile.acm_problems_status, solvedSet, attemptedSet);
  collectStatusSets(profile.oi_problems_status, solvedSet, attemptedSet);
  return { solvedSet, attemptedSet };
}

function normalizeProfile(raw, fallbackUsername) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const user = raw.user && typeof raw.user === "object" ? raw.user : {};
  const { solvedSet, attemptedSet } = buildProfileStatusSets(raw);
  const accepted = toNumberOrNull(raw.accepted_number);
  const submissions = toNumberOrNull(raw.submission_number);
  return {
    username: String(firstDefined(raw.username, user.username, fallbackUsername, "")),
    avatar: String(firstDefined(raw.avatar, user.avatar, "")),
    school: String(firstDefined(raw.school, user.school, "")),
    mood: String(firstDefined(raw.mood, user.mood, "")),
    acceptedNumber: accepted === null ? solvedSet.size : accepted,
    submissionNumber: submissions === null ? 0 : submissions,
    totalScore: toNumberOrNull(raw.total_score) || 0,
    solvedSet,
    attemptedSet,
    fetchedAt: new Date().toISOString()
  };
}

function normalizeRankRow(raw, index, offset) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const user = raw.user && typeof raw.user === "object" ? raw.user : raw;
  const username = String(firstDefined(user.username, raw.username, ""));
  if (!username) {
    return null;
  }
  return {
    position: Number(offset || 0) + Number(index || 0) + 1,
    rank: Number(offset || 0) + Number(index || 0) + 1,
    username,
    userId: firstDefined(user.id, raw.user_id, null),
    avatar: String(firstDefined(raw.avatar, user.avatar, "")),
    school: String(firstDefined(raw.school, user.school, "")),
    major: String(firstDefined(raw.major, user.major, "")),
    mood: String(firstDefined(raw.mood, user.mood, "")),
    acceptedNumber:
      toNumberOrNull(firstDefined(raw.accepted_number, raw.acceptedNumber)) || 0,
    submissionNumber:
      toNumberOrNull(firstDefined(raw.submission_number, raw.submissionNumber)) || 0,
    totalScore: toNumberOrNull(raw.total_score) || 0
  };
}

function normalizeRankPage(response, offset) {
  const results = Array.isArray(response && response.results) ? response.results : [];
  return {
    offset: Number(offset || 0),
    total: toNumberOrNull(response && response.total) || 0,
    results: results
      .map((row, index) => normalizeRankRow(row, index, offset))
      .filter(Boolean)
  };
}

function normalizeSubmissionPage(response, context = {}) {
  const results = Array.isArray(response && response.results) ? response.results : [];
  return {
    total: toNumberOrNull(response && response.total) || 0,
    results: results.map((row) => normalizeSubmission(row, context)).filter(Boolean)
  };
}

function createSiteApi(client) {
  function request(path) {
    return client.request(path);
  }

  async function getProfile(username) {
    const query = new URLSearchParams();
    if (username) {
      query.set("username", username);
    }
    const data = await request(`/api/profile${query.toString() ? `?${query.toString()}` : ""}`);
    return normalizeProfile(data, username);
  }

  async function getRankPage({ offset = 0, limit = 2000, rule = "acm" } = {}) {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      rule
    });
    const data = await request(`/api/user_rank?${query.toString()}`);
    return normalizeRankPage(data, offset);
  }

  async function getProblemPage({ offset = 0, limit = 200, keyword, difficulty, tag } = {}) {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit)
    });
    if (keyword) {
      query.set("keyword", keyword);
    }
    if (difficulty) {
      query.set("difficulty", difficulty);
    }
    if (tag) {
      query.set("tag", tag);
    }
    const data = await request(`/api/problem?${query.toString()}`);
    const results = Array.isArray(data && data.results) ? data.results : [];
    return {
      total: toNumberOrNull(data && data.total) || 0,
      results: results.map((row) => normalizeProblem(row)).filter(Boolean)
    };
  }

  async function getSubmissions({ offset = 0, limit = 50, username, problemId, result, language, myself } = {}) {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit)
    });
    if (username) {
      query.set("username", username);
    }
    if (problemId) {
      query.set("problem_id", String(problemId));
    }
    if (result !== undefined && result !== null && result !== "") {
      query.set("result", String(result));
    }
    if (language) {
      query.set("language", language);
    }
    if (myself) {
      query.set("myself", "true");
    }
    const data = await request(`/api/submissions?${query.toString()}`);
    return normalizeSubmissionPage(data, { username });
  }

  /**
   * 题库（实验）内提交。公开的 /api/submissions 会排除所有实验提交，
   * 所以竞速必须走这个接口。
   */
  async function getContestSubmissions({
    contestId,
    offset = 0,
    limit = 50,
    username,
    problemId,
    result
  } = {}) {
    if (contestId === undefined || contestId === null || contestId === "") {
      throw new Error("缺少题库 id，无法查询提交");
    }
    const query = new URLSearchParams({
      contest_id: String(contestId),
      offset: String(offset),
      limit: String(limit)
    });
    if (username) {
      query.set("username", String(username));
    }
    if (problemId) {
      query.set("problem_id", String(problemId));
    }
    if (result !== undefined && result !== null && result !== "") {
      query.set("result", String(result));
    }
    const data = await request(`/api/contest_submissions?${query.toString()}`);
    return normalizeSubmissionPage(data, { username, contestId });
  }

  async function getUserContests(username, { offset = 0, limit = 20 } = {}) {
    const query = new URLSearchParams({
      username: username || "",
      offset: String(offset),
      limit: String(limit)
    });
    const data = await request(`/api/profile/contests?${query.toString()}`);
    const results = Array.isArray(data && data.results) ? data.results : [];
    return {
      total: toNumberOrNull(data && data.total) || 0,
      results: results.map((row) => ({
        contestId: firstDefined(row.contest_id, row.id, null),
        title: String(firstDefined(row.contest_title, row.title, "")),
        ruleType: String(firstDefined(row.rule_type, "")),
        endTime: parseServerTime(row.end_time),
        acCount: toNumberOrNull(row.ac_count) || 0,
        submissionCount: toNumberOrNull(row.submission_count) || 0,
        totalScore: toNumberOrNull(row.total_score) || 0,
        myRank: toNumberOrNull(row.my_rank)
      }))
    };
  }

  async function getContestDetail(username, contestId) {
    const query = new URLSearchParams({
      username: username || "",
      contest_id: String(contestId)
    });
    const data = await request(`/api/profile/contest_detail?${query.toString()}`);
    const items = Array.isArray(data && data.problem_items) ? data.problem_items : [];
    return items.map((item) => ({
      displayId: String(firstDefined(item.display_id, item._id, "")),
      title: String(firstDefined(item.title, "")),
      isAc: Boolean(item.is_ac),
      errorNumber: toNumberOrNull(item.error_number) || 0,
      acTime: toNumberOrNull(item.ac_time),
      bestScore: toNumberOrNull(item.best_score)
    }));
  }

  /**
   * 拉取完整题目目录。站点单页上限 250，这里默认 200；最多 max 条。
   * onProgress({loaded,total}) 用于 UI 进度；取消由调用方通过 signal 控制。
   */
  async function getAllProblems({ pageSize = 200, max = 5000, onProgress } = {}) {
    const collected = [];
    let total = 0;
    let offset = 0;
    while (collected.length < max) {
      const page = await getProblemPage({ offset, limit: pageSize });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      collected.push(...page.results);
      if (typeof onProgress === "function") {
        onProgress({ loaded: Math.min(collected.length, total), total });
      }
      offset += page.results.length;
      if (offset >= total) {
        break;
      }
    }
    const truncated = collected.length > max;
    return {
      problems: collected.slice(0, max),
      total,
      truncated
    };
  }

  /** 翻页拉取全部 AC 提交，构建已解决展示号集合。 */
  async function getAllSolvedSubmissions(username, { pageSize = 250, maxPages = 40 } = {}) {
    const solved = new Set();
    let total = 0;
    let offset = 0;
    let pages = 0;
    while (pages < maxPages) {
      const page = await getSubmissions({
        offset,
        limit: pageSize,
        username,
        result: 0
      });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      for (const submission of page.results) {
        if (submission.resultKey === "AC" && submission.problemDisplayId) {
          solved.add(submission.problemDisplayId);
        }
      }
      offset += page.results.length;
      pages += 1;
      if (offset >= total) {
        break;
      }
    }
    return { solvedSet: solved, total, pages, truncated: offset < total };
  }

  /** 翻页拉取某道题的 AC 提交，用于本题首 AC 榜。 */
  async function getProblemAcSubmissions(problemId, { pageSize = 250, maxPages = 8 } = {}) {
    const results = [];
    let total = 0;
    let offset = 0;
    let pages = 0;
    while (pages < maxPages) {
      const page = await getSubmissions({
        offset,
        limit: pageSize,
        problemId,
        result: 0
      });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      results.push(...page.results);
      offset += page.results.length;
      pages += 1;
      if (offset >= total) {
        break;
      }
    }
    return { results, total, truncated: offset < total };
  }

  /**
   * 翻页拉取某道题的全部公开提交，用于计算“首次提交 → 首次 AC”的用时。
   * 站点按时间倒序返回；截断时最早的记录会缺失，调用方需标注。
   */
  async function getProblemSubmissions(problemId, { pageSize = 250, maxPages = 10 } = {}) {
    const results = [];
    let total = 0;
    let offset = 0;
    let pages = 0;
    while (pages < maxPages) {
      const page = await getSubmissions({ offset, limit: pageSize, problemId });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      results.push(...page.results);
      offset += page.results.length;
      pages += 1;
      if (offset >= total) {
        break;
      }
    }
    return { results, total, truncated: offset < total };
  }

  /** 拉取某个用户最近的公开提交（默认最多 2 页），用于对手战绩。 */
  async function getUserSubmissions(username, { pageSize = 250, maxPages = 2 } = {}) {
    const results = [];
    let total = 0;
    let offset = 0;
    let pages = 0;
    while (pages < maxPages) {
      const page = await getSubmissions({
        offset,
        limit: pageSize,
        username
      });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      results.push(...page.results);
      offset += page.results.length;
      pages += 1;
      if (offset >= total) {
        break;
      }
    }
    return { results, total, truncated: offset < total };
  }

  /** 拉取一个用户在题库内的提交（默认最多 2 页），题库竞速用。 */
  async function getContestUserSubmissions(
    contestId,
    username,
    { pageSize = 250, maxPages = 2, problemId } = {}
  ) {
    const results = [];
    let total = 0;
    let offset = 0;
    let pages = 0;
    while (pages < maxPages) {
      const page = await getContestSubmissions({
        contestId,
        offset,
        limit: pageSize,
        username,
        problemId
      });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      results.push(...page.results);
      offset += page.results.length;
      pages += 1;
      if (offset >= total) {
        break;
      }
    }
    return { results, total, truncated: offset < total };
  }

  /** 顺序拉取全站榜单，直到凑满 total 或达到页数上限。 */
  async function getAllRank({ rule = "acm", pageSize = 2000, maxPages = 10 } = {}) {
    const pages = [];
    let total = 0;
    let offset = 0;
    while (pages.length < maxPages) {
      const page = await getRankPage({ offset, limit: pageSize, rule });
      total = page.total;
      if (!page.results.length) {
        break;
      }
      pages.push(page);
      offset += page.results.length;
      if (offset >= total) {
        break;
      }
    }
    return { pages, total, truncated: offset < total };
  }

  return {
    getProfile,
    getRankPage,
    getProblemPage,
    getSubmissions,
    getUserContests,
    getContestDetail,
    getAllProblems,
    getAllSolvedSubmissions,
    getProblemAcSubmissions,
    getProblemSubmissions,
    getUserSubmissions,
    getContestSubmissions,
    getContestUserSubmissions,
    getAllRank
  };
}

module.exports = {
  JUDGE_STATUS,
  RESULT_LABELS,
  parseServerTime,
  normalizeResultCode,
  resultKeyFromCode,
  normalizeProblem,
  normalizeSubmission,
  normalizeSubmissionPage,
  buildProfileStatusSets,
  normalizeProfile,
  normalizeRankRow,
  normalizeRankPage,
  isExamContest,
  isQuestionBankContest,
  createSiteApi
};
