const vscode = require("vscode");
const path = require("path");
const fs = require("fs/promises");

const { XmuojClient } = require("./client");
const { XmuojCodeLensProvider } = require("./codeLens");
const { ProblemTreeDataProvider } = require("./treeData");
const {
  METADATA_FILE_NAME,
  buildProblemDirectory,
  chooseWorkspaceRoot,
  createWorkspaceTasks,
  ensureProblemWorkspace,
  findProblemMetadata,
  getSourceFileName,
  saveTestCaseArchive,
  writeProblemMetadata
} = require("./problemWorkspace");
const { runLocalCases } = require("./runner");

const RECENT_CONTESTS_KEY = "xmuoj.recentContests";
const RECENT_PROBLEMS_KEY = "xmuoj.recentProblems";
const LAST_SUBMISSION_RESULT_KEY = "xmuoj.lastSubmissionResult";
const LAST_LOCAL_REPORT_KEY = "xmuoj.lastLocalReport";
const PROBLEM_PROGRESS_KEY = "xmuoj.problemProgress";
const SUBMISSION_HISTORY_KEY = "xmuoj.submissionHistory";
const WORKBENCH_LAYOUT_KEY = "xmuoj.workbenchLayout";
const LANGUAGE_PRIORITY = ["C++", "Python3", "Java", "C"];
const ACCEPTED_RESULTS = new Set(["Accepted", "AC"]);

function isSideModeEnabled() {
  return Boolean(vscode.workspace.getConfiguration("xmuoj").get("enableSideMode", true));
}

function getProblemViewColumn() {
  return vscode.ViewColumn.One;
}

function getWorkspaceViewColumn() {
  return isSideModeEnabled() ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
}

function getResultViewColumn() {
  return isSideModeEnabled() ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildProblemProgressKey(baseUrl, contestId, problemId) {
  return [baseUrl || "", contestId || "problemset", problemId || "unknown"].join("::");
}

function buildProblemProgressRef(baseUrl, problem, contest) {
  if (!problem || !problem.id) {
    return null;
  }
  return {
    key: buildProblemProgressKey(baseUrl, contest ? contest.id : null, problem.id),
    baseUrl,
    problemId: problem.id,
    displayId: problem.display_id,
    title: problem.title,
    contestId: contest ? contest.id : null,
    contestTitle: contest ? contest.title : null
  };
}

function getProblemProgress(state, baseUrl, problem, contest) {
  if (!state.problemProgress || !problem || !problem.id) {
    return null;
  }
  return state.problemProgress[buildProblemProgressKey(baseUrl, contest ? contest.id : null, problem.id)] || null;
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

function isAdminUser(user) {
  return Boolean(
    user
    && (
      user.is_admin_role
      || user.isAdminRole
      || user.admin_type === "Admin"
      || user.admin_type === "Super Admin"
      || user.adminType === "Admin"
      || user.adminType === "Super Admin"
    )
  );
}

function renderActionButton(command, icon, label, variant = "secondary") {
  return `<button class="action-button ${variant} icon-button" data-command="${command}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</button>`;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProblemPlainText(problem) {
  const sampleText = (problem.samples || []).map((sample, index) => {
    return `样例 ${index + 1}\n输入:\n${sample.input || ""}\n输出:\n${sample.output || ""}`;
  }).join("\n\n");
  return [
    `题号: ${problem.display_id}`,
    `标题: ${problem.title}`,
    `难度: ${problem.difficulty || "未知"}`,
    `规则: ${problem.rule_type}`,
    `可用语言: ${(problem.languages || []).join(", ")}`,
    `题目描述: ${stripHtml(problem.description)}`,
    `输入描述: ${stripHtml(problem.input_description)}`,
    `输出描述: ${stripHtml(problem.output_description)}`,
    problem.hint ? `提示: ${stripHtml(problem.hint)}` : "",
    sampleText ? `样例:\n${sampleText}` : ""
  ].filter(Boolean).join("\n\n");
}

async function getCopilotModel() {
  if (!vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
    throw new Error("当前 VS Code 不支持语言模型接口，请升级 VS Code 并安装/启用 GitHub Copilot Chat。");
  }
  const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
  if (!models.length) {
    throw new Error("没有可用的 Copilot 模型。请确认已安装并登录 GitHub Copilot Chat。");
  }
  return models[0];
}

async function collectLanguageModelText(response) {
  let text = "";
  for await (const chunk of response.text) {
    text += chunk;
  }
  return text.trim();
}

async function generateAiSolutionContent(problem) {
  const model = await getCopilotModel();
  const prompt = [
    "你是一名资深算法教练。",
    "请根据下面这道 OJ 题，输出一份中文题解。",
    "要求：1. 先解释题意 2. 给出核心思路 3. 说明时间复杂度和空间复杂度 4. 给出容易错的点 5. 不要输出代码。",
    "题目信息如下：",
    buildProblemPlainText(problem)
  ].join("\n\n");
  const response = await model.sendRequest([
    vscode.LanguageModelChatMessage.User(prompt)
  ], {}, new vscode.CancellationTokenSource().token);
  return collectLanguageModelText(response);
}

async function generateAiCodeContent(problem, language) {
  const model = await getCopilotModel();
  const prompt = [
    "你是一名资深算法竞赛程序员。",
    `请使用 ${language} 为下面这道 OJ 题生成可提交的完整代码。`,
    "要求：1. 代码要能直接提交 2. 尽量符合竞赛/OJ 风格 3. 只输出纯代码，不要 Markdown 代码块，不要任何解释。",
    "题目信息如下：",
    buildProblemPlainText(problem)
  ].join("\n\n");
  const response = await model.sendRequest([
    vscode.LanguageModelChatMessage.User(prompt)
  ], {}, new vscode.CancellationTokenSource().token);
  return collectLanguageModelText(response);
}

function normalizeAiCodeOutput(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:[a-zA-Z0-9#+-]*)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : trimmed;
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
    updatedAt: new Date().toISOString()
  }, patch);
  state.problemProgress = Object.assign({}, state.problemProgress, {
    [progressRef.key]: next
  });
  await context.globalState.update(PROBLEM_PROGRESS_KEY, state.problemProgress);
  return next;
}

function renderProblemHtml(problem, baseUrl, workspaceState = {}, user = null) {
  const workspaceSummary = workspaceState.hasWorkspace
    ? `<div class="workspace-banner">已绑定本地文件 ${escapeHtml(workspaceState.sourceFileName || "")}${workspaceState.language ? ` · ${escapeHtml(workspaceState.language)}` : ""}</div>`
    : `<div class="workspace-banner workspace-banner-empty">还没有本地代码文件，先点击“开始作答”创建工作区。</div>`;
  const actionLabel = workspaceState.hasWorkspace ? "继续作答" : "开始作答";
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
  const adminAiActions = isAdminUser(user)
    ? `
        ${renderActionButton("aiSolution", "✨", "AI解题")}
        ${renderActionButton("aiCode", "🤖", "AI代码")}`
    : "";

  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 24px; background: linear-gradient(180deg, #f3efe3 0%, #f7f7f2 100%); color: #17312f; }
        h1, h2, h3, h4 { color: #0b5d5b; }
        .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
        .pill { background: #d7ebe5; border-radius: 999px; padding: 6px 12px; font-size: 12px; }
        .panel { background: rgba(255,255,255,0.72); border: 1px solid #d5ddd4; border-radius: 16px; padding: 18px; margin-bottom: 18px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
        .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; align-items: center; }
        .action-button { border: 0; border-radius: 999px; padding: 10px 16px; background: #0b5d5b; color: #f7f7f2; cursor: pointer; font-size: 14px; }
        .action-button.secondary { background: #d7ebe5; color: #17312f; }
        .icon-button { width: 52px; height: 52px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; line-height: 1; box-shadow: 0 4px 16px rgba(11, 93, 91, 0.08); }
        .icon-button.primary { background: #0b5d5b; color: #f7f7f2; }
        .icon-button:hover { transform: translateY(-1px); }
        .workspace-banner { margin-bottom: 18px; padding: 12px 14px; border-radius: 14px; background: #d7ebe5; }
        .workspace-banner-empty { background: #f2e7cf; }
        pre { white-space: pre-wrap; background: #132322; color: #f6f3ea; padding: 12px; border-radius: 12px; overflow: auto; }
        a { color: #9a3b2f; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(problem.display_id)} ${escapeHtml(problem.title)}</h1>
      <div class="actions">
        ${renderActionButton("startWork", workspaceState.hasWorkspace ? "✍" : "▶", actionLabel, "primary")}
        ${renderActionButton("runTests", "🧪", "运行本地测试")}
        ${renderActionButton("downloadTests", "⬇", "下载测试数据")}
        ${renderActionButton("submit", "⤴", "提交评测")}
        ${renderActionButton("showResults", "📊", "查看结果面板")}
        ${renderActionButton("switchLanguage", "🌐", "切换语言")}
        ${adminAiActions}
      </div>
      ${workspaceSummary}
      <div class="meta">
        ${progressBadge}
        <span class="pill">${escapeHtml(problem.rule_type)}</span>
        <span class="pill">${escapeHtml(problem.difficulty || "未知")}</span>
        <span class="pill">${escapeHtml((problem.languages || []).join(", "))}</span>
      </div>
      <section class="panel">${problem.description || ""}</section>
      <section class="panel">
        <h2>输入描述</h2>
        ${problem.input_description || ""}
        <h2>输出描述</h2>
        ${problem.output_description || ""}
      </section>
      ${samples ? `<section class="panel"><h2>样例</h2>${samples}</section>` : ""}
      ${problem.hint ? `<section class="panel"><h2>提示</h2>${problem.hint}</section>` : ""}
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

function renderSubmissionResultSection(result, baseUrl) {
  const stats = result.statistic_info || {};
  const details = result.info ? `<pre>${escapeHtml(JSON.stringify(result.info, null, 2))}</pre>` : "<p>没有更详细的判题数据。</p>";
  return `
      <section class="panel">
        <h2>最近一次在线提交</h2>
        <div>
          <span class="pill">${escapeHtml(result.result_label)}</span>
          <span class="pill">${escapeHtml(result.language)}</span>
          <span class="pill">${escapeHtml(result.display_id)}</span>
          <span class="pill">提交 #${escapeHtml(String(result.id))}</span>
        </div>
        <p><strong>时间：</strong> ${escapeHtml(String(stats.time_cost || "无"))}</p>
        <p><strong>内存：</strong> ${escapeHtml(String(stats.memory_cost || "无"))}</p>
        <p><strong>得分：</strong> ${escapeHtml(String(stats.score || "无"))}</p>
        <p><strong>错误信息：</strong> ${escapeHtml(String(stats.err_info || ""))}</p>
        <p><a href="${baseUrl}">打开 XMUOJ</a></p>
        <h3>原始判题详情</h3>
        ${details}
      </section>`;
}

function renderLocalReportSection(report, baseUrl) {
  const rows = (report.results || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${item.passed ? "PASS" : "FAIL"}</td>
      <td>${escapeHtml(String(item.exitCode))}</td>
      <td><pre>${escapeHtml(item.expected || "")}</pre></td>
      <td><pre>${escapeHtml(item.actual || "")}</pre></td>
      <td><pre>${escapeHtml(item.stderr || "")}</pre></td>
    </tr>
  `).join("");
  return `
      <section class="panel">
        <h2>最近一次本地测试</h2>
        <div>
          <span class="pill">${escapeHtml(report.displayId || "未知题号")}</span>
          <span class="pill">${escapeHtml(report.language || "未知语言")}</span>
          <span class="pill">${escapeHtml(String(report.passed || 0))}/${escapeHtml(String(report.total || 0))} 通过</span>
          <span class="pill">${report.failed === 0 ? "全部通过" : "仍有失败"}</span>
        </div>
        <p><strong>题目：</strong> ${escapeHtml(report.title || "未知题目")}</p>
        <p><strong>工作区：</strong> ${escapeHtml(report.problemDir || "")}</p>
        <p><strong>测试目录：</strong> ${escapeHtml(report.caseDir || "")}</p>
        <p><strong>判题站点：</strong> <a href="${baseUrl}">${escapeHtml(baseUrl)}</a></p>
        <h3>测试点详情</h3>
        <table>
          <thead>
            <tr>
              <th>测试点</th>
              <th>状态</th>
              <th>退出码</th>
              <th>期望输出</th>
              <th>实际输出</th>
              <th>错误输出</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderSubmissionHistorySection(history) {
  const rows = (history || []).map((item) => `
    <tr>
      <td>${escapeHtml(String(item.id || ""))}</td>
      <td>${escapeHtml(item.display_id || "")}</td>
      <td>${escapeHtml(item.title || "")}</td>
      <td>${escapeHtml(item.result_label || "")}</td>
      <td>${escapeHtml(item.language || "")}</td>
      <td>${escapeHtml(item.submittedAt || "")}</td>
    </tr>
  `).join("");
  return `
      <section class="panel">
        <h2>最近提交历史</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>题号</th>
              <th>题目</th>
              <th>结果</th>
              <th>语言</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">还没有提交历史。</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderResultPanelHtml(localReport, submissionResult, submissionHistory, baseUrl) {
  const updates = [];
  if (localReport) {
    updates.push(`<li>本地测试 ${escapeHtml(localReport.displayId || "")}: ${escapeHtml(String(localReport.passed || 0))}/${escapeHtml(String(localReport.total || 0))}</li>`);
  }
  if (submissionResult) {
    updates.push(`<li>在线提交 ${escapeHtml(submissionResult.display_id || "")}: ${escapeHtml(submissionResult.result_label || "未知")}</li>`);
  }
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; padding: 24px; background: linear-gradient(180deg, #f3efe3 0%, #f7f7f2 100%); color: #17312f; }
        h1, h2 { color: #0b5d5b; }
        .pill { display: inline-block; background: #d7ebe5; border-radius: 999px; padding: 6px 12px; margin-right: 8px; margin-bottom: 8px; }
        .panel { background: rgba(255,255,255,0.72); border: 1px solid #d5ddd4; border-radius: 16px; padding: 18px; margin-bottom: 18px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #d5ddd4; padding: 10px; vertical-align: top; text-align: left; }
        pre { white-space: pre-wrap; background: #132322; color: #f6f3ea; padding: 12px; border-radius: 12px; overflow: auto; margin: 0; }
        a { color: #9a3b2f; }
      </style>
    </head>
    <body>
      <h1>XMUOJ 结果面板</h1>
      <section class="panel">
        <h2>最近动态</h2>
        <ul>${updates.length ? updates.join("") : "<li>还没有结果记录，先运行一次本地测试或提交代码。</li>"}</ul>
      </section>
      ${renderSubmissionHistorySection(submissionHistory)}
      ${localReport ? renderLocalReportSection(localReport, localReport.baseUrl || baseUrl) : ""}
      ${submissionResult ? renderSubmissionResultSection(submissionResult, submissionResult.baseUrl || baseUrl) : ""}
    </body>
  </html>`;
}

function updateStatusBars(state, userStatusBar, contestStatusBar, client) {
  state.baseUrl = client.baseUrl;
  userStatusBar.text = state.user ? `XMUOJ $(account) ${state.user.username}` : "XMUOJ $(circle-slash) 未登录";
  userStatusBar.tooltip = `站点地址：${client.baseUrl}`;
  contestStatusBar.text = state.contestWorkspace ? `XMUOJ $(book) ${state.contestWorkspace.contest.title}` : "XMUOJ $(book) 未打开比赛";
  contestStatusBar.tooltip = state.contestWorkspace ? `比赛 #${state.contestWorkspace.contest.id}` : "先打开或浏览一个比赛";
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

async function maybeSwitchBaseUrl(client, metadata) {
  if (!metadata || !metadata.baseUrl || metadata.baseUrl === client.baseUrl) {
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `当前文件绑定的站点是 ${metadata.baseUrl}，但插件当前使用的是 ${client.baseUrl}。`,
    "切换站点地址",
    "保持当前设置"
  );
  if (choice === "切换站点地址") {
    await client.setBaseUrl(metadata.baseUrl);
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
  await maybeSwitchBaseUrl(client, metadataEntry.metadata);
  return {
    metadata: metadataEntry.metadata,
    metadataPath: metadataEntry.metadataPath,
    problemDir: path.dirname(metadataEntry.metadataPath)
  };
}

async function resolveSourceContext(client, state) {
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

  if (state.activeProblem) {
    const contest = state.contestWorkspace ? state.contestWorkspace.contest : null;
    const existingWorkspace = await findExistingProblemWorkspace(state.activeProblem, contest);
    if (existingWorkspace) {
      await maybeSwitchBaseUrl(client, existingWorkspace.metadata);
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
  if (state.activeProblem) {
    return state.activeProblem;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }
  const metadataContext = await getEditorProblemContext(client, editor.document);
  if (!metadataContext.metadata) {
    return null;
  }
  const detail = await client.getProblemWorkspace(
    metadataContext.metadata.problemId,
    metadataContext.metadata.contestId || undefined,
    state.contestPassword || undefined
  );
  state.activeProblem = detail;
  state.activeContest = metadataContext.metadata.contestId
    ? {
        id: metadataContext.metadata.contestId,
        title: metadataContext.metadata.contestTitle || ""
      }
    : null;
  if (state.problemPanel) {
    await refreshProblemPanel(state, client);
  }
  if (typeof state.persistenceHook === "function") {
    await state.persistenceHook();
  }
  return detail;
}

async function saveRecentContest(context, contest, baseUrl) {
  const recent = context.globalState.get(RECENT_CONTESTS_KEY, []);
  const next = [
    { id: contest.id, title: contest.title, require_password: contest.require_password, baseUrl },
    ...recent.filter(item => !(item.id === contest.id && item.baseUrl === baseUrl))
  ].slice(0, 8);
  await context.globalState.update(RECENT_CONTESTS_KEY, next);
  return next;
}

async function saveRecentProblem(context, problem, baseUrl, contest) {
  const recent = context.globalState.get(RECENT_PROBLEMS_KEY, []);
  const nextItem = {
    problemId: problem.id,
    displayId: problem.display_id,
    title: problem.title,
    baseUrl,
    contestId: contest ? contest.id : null,
    contestTitle: contest ? contest.title : null,
    contestRequirePassword: contest ? Boolean(contest.require_password) : false
  };
  const next = [
    nextItem,
    ...recent.filter(item => !(item.problemId === nextItem.problemId && item.baseUrl === nextItem.baseUrl && item.contestId === nextItem.contestId))
  ].slice(0, 20);
  await context.globalState.update(RECENT_PROBLEMS_KEY, next);
  return next;
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

async function persistWorkbenchLayout(context, state) {
  const layout = {
    baseUrl: state.baseUrl,
    sourcePath: state.currentSourcePath || null,
    problemPanelVisible: Boolean(state.problemPanel),
    resultPanelVisible: Boolean(state.resultPanel),
    activeProblem: state.activeProblem ? {
      id: state.activeProblem.id,
      displayId: state.activeProblem.display_id,
      title: state.activeProblem.title,
      contestId: state.activeContest ? state.activeContest.id : null,
      contestTitle: state.activeContest ? state.activeContest.title : null
    } : null
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
    if (layout.baseUrl && layout.baseUrl !== client.baseUrl) {
      await client.setBaseUrl(layout.baseUrl);
      state.baseUrl = layout.baseUrl;
    }
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
    if (layout.activeProblem && layout.problemPanelVisible) {
      const contest = layout.activeProblem.contestId ? { id: layout.activeProblem.contestId, title: layout.activeProblem.contestTitle } : null;
      try {
        await openProblemDetail(client, state, {
          id: layout.activeProblem.id,
          display_id: layout.activeProblem.displayId,
          title: layout.activeProblem.title
        }, contest, state.contestPassword || undefined);
      } catch (error) {
        null;
      }
    }
    if (layout.resultPanelVisible && (state.lastLocalReport || state.lastSubmissionResult || (state.submissionHistory && state.submissionHistory.length))) {
      await showResultPanel(state, client);
    }
  } catch (error) {
    return;
  }
}

async function loadContestWorkspace(client, state, treeProvider, contestId, contestPassword) {
  state.contestPassword = contestPassword || "";
  state.contestWorkspace = await client.getContestWorkspace(contestId, state.contestPassword);
  state.activeProblem = null;
  treeProvider.refresh();
  return state.contestWorkspace;
}

async function findExistingProblemWorkspace(problem, contest) {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  for (const folder of workspaceFolders) {
    const problemDir = buildProblemDirectory(folder.uri.fsPath, problem, contest);
    const metadataPath = path.join(problemDir, METADATA_FILE_NAME);
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      const sourceFilePath = path.join(problemDir, metadata.sourceFile || getSourceFileName(metadata.language));
      return {
        workspaceRoot: folder.uri.fsPath,
        problemDir,
        metadataPath,
        metadata,
        sourceFilePath
      };
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
}

async function getCurrentProblemWorkspaceState(state) {
  if (!state.activeProblem) {
    return { hasWorkspace: false };
  }
  const contest = state.contestWorkspace ? state.contestWorkspace.contest : null;
  const existingWorkspace = await findExistingProblemWorkspace(state.activeProblem, contest);
  if (!existingWorkspace) {
    return { hasWorkspace: false };
  }
  return {
    hasWorkspace: true,
    language: existingWorkspace.metadata.language,
    sourceFileName: existingWorkspace.metadata.sourceFile,
    sourceFilePath: existingWorkspace.sourceFilePath,
    problemDir: existingWorkspace.problemDir,
    progressSummary: getProblemProgressSummary(
      getProblemProgress(
        state,
        existingWorkspace.metadata.baseUrl || state.baseUrl,
        state.activeProblem,
        state.contestWorkspace ? state.contestWorkspace.contest : null
      )
    )
  };
}

async function refreshProblemPanel(state, client) {
  if (!state.problemPanel || !state.activeProblem) {
    return;
  }
  const workspaceState = await getCurrentProblemWorkspaceState(state);
  state.problemPanel.title = `${state.activeProblem.display_id} ${state.activeProblem.title}`;
  state.problemPanel.webview.html = renderProblemHtml(state.activeProblem, client.baseUrl, workspaceState, state.user);
}

async function openWorkspaceSourceFile(sourceFilePath) {
  const document = await vscode.workspace.openTextDocument(sourceFilePath);
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: getWorkspaceViewColumn() });
}

async function startWorkingOnProblem(context, client, state, outputChannel) {
  if (!state.activeProblem) {
    vscode.window.showWarningMessage("请先打开题目，再开始作答");
    return null;
  }
  const contest = state.contestWorkspace ? state.contestWorkspace.contest : null;
  let workspace = await findExistingProblemWorkspace(state.activeProblem, contest);
  if (!workspace) {
    const createdWorkspace = await ensureLocalProblemWorkspace(client, state, state.activeProblem, outputChannel);
    if (!createdWorkspace) {
      return null;
    }
    workspace = createdWorkspace;
    const downloadChoice = state.activeProblem.can_download_test_case
      ? await vscode.window.showInformationMessage(
        "题目工作区已创建，是否顺便下载公开测试数据？",
        "下载",
        "暂不下载"
      )
      : null;
    if (downloadChoice === "下载") {
      await ensureTestCasesAvailable(client, state, outputChannel, workspace.problemDir, state.activeProblem);
    }
  }
  await updateProblemProgress(context, state, buildProblemProgressRef(client.baseUrl, state.activeProblem, contest), {
    workspaceCreated: true,
    language: workspace.metadata.language,
    sourceFile: workspace.metadata.sourceFile
  });
  await openWorkspaceSourceFile(workspace.sourceFilePath);
  await rememberSourceFile(context, state, workspace.sourceFilePath);
  await refreshProblemPanel(state, client);
  return workspace;
}

async function openProblemDetail(client, state, problem, contest, contestPassword) {
  const detail = await client.getProblemWorkspace(problem.id, contest ? contest.id : undefined, contestPassword);
  state.activeProblem = detail;
  state.activeContest = contest || null;
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
          await vscode.commands.executeCommand("xmuoj.startWorkingOnProblem");
        } else if (message.command === "runTests") {
          await vscode.commands.executeCommand("xmuoj.runLocalTests");
        } else if (message.command === "downloadTests") {
          await vscode.commands.executeCommand("xmuoj.downloadTestCases");
        } else if (message.command === "submit") {
          await vscode.commands.executeCommand("xmuoj.submitCurrentFile");
        } else if (message.command === "showResults") {
          await vscode.commands.executeCommand("xmuoj.showResultPanel");
        } else if (message.command === "switchLanguage") {
          await vscode.commands.executeCommand("xmuoj.switchProblemLanguage");
        } else if (message.command === "aiSolution") {
          await vscode.commands.executeCommand("xmuoj.generateAiSolution");
        } else if (message.command === "aiCode") {
          await vscode.commands.executeCommand("xmuoj.generateAiCode");
        }
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
      }
    });
    state.problemPanel = panel;
  } else {
    panel.reveal(getProblemViewColumn(), false);
  }
  await refreshProblemPanel(state, client);
  if (typeof state.persistenceHook === "function") {
    await state.persistenceHook();
  }
  return detail;
}

async function showResultPanel(state, client) {
  let panel = state.resultPanel;
  if (!panel) {
    panel = vscode.window.createWebviewPanel("xmuojResultPanel", "XMUOJ 结果面板", getResultViewColumn(), {
      enableScripts: false,
      retainContextWhenHidden: true
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
    panel.reveal(getResultViewColumn(), true);
  }
  panel.webview.html = renderResultPanelHtml(state.lastLocalReport, state.lastSubmissionResult, state.submissionHistory || [], client.baseUrl);
  if (typeof state.persistenceHook === "function") {
    await state.persistenceHook();
  }
  return panel;
}

async function showSubmissionResultPanel(context, state, client, result) {
  state.lastSubmissionResult = Object.assign({}, result, { baseUrl: client.baseUrl });
  await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, state.lastSubmissionResult);
  await showResultPanel(state, client);
}

async function showLocalReportPanel(context, state, client, report) {
  state.lastLocalReport = Object.assign({}, report, { baseUrl: client.baseUrl });
  await context.globalState.update(LAST_LOCAL_REPORT_KEY, state.lastLocalReport);
  await showResultPanel(state, client);
}

async function chooseLanguage(problem, suggestedLanguage) {
  const languages = problem.languages || [];
  if (!languages.length) {
    throw new Error("这道题当前没有可用语言");
  }
  if (suggestedLanguage && languages.includes(suggestedLanguage)) {
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

async function runQuickStartAction() {
  const pick = await vscode.window.showQuickPick([
    { label: "设置站点地址", command: "xmuoj.configureBaseUrl" },
    { label: "登录", command: "xmuoj.login" },
    { label: "浏览比赛", command: "xmuoj.browseContests" },
    { label: "浏览题库", command: "xmuoj.browseProblemset" },
    { label: "创建本地题目工作区", command: "xmuoj.createProblemWorkspace" },
    { label: "下载测试数据", command: "xmuoj.downloadTestCases" },
    { label: "生成本地任务", command: "xmuoj.generateLocalTasks" },
    { label: "运行本地测试", command: "xmuoj.runLocalTests" },
    { label: "提交当前文件", command: "xmuoj.submitCurrentFile" },
    { label: "重新打开最近题目", command: "xmuoj.reopenRecentProblem" }
  ], {
    title: "XMUOJ 快速开始",
    placeHolder: "选择下一步要执行的操作",
    ignoreFocusOut: true
  });
  if (pick) {
    await vscode.commands.executeCommand(pick.command);
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
    state.recentProblems = await saveRecentProblem(context, detail, client.baseUrl, state.contestWorkspace.contest);
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
    return null;
  }
  const suggestedLanguage = options.suggestedLanguage || (vscode.window.activeTextEditor ? inferLanguage(vscode.window.activeTextEditor.document) : null);
  const language = await chooseLanguage(problem, suggestedLanguage);
  if (!language) {
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
  if ((metadataContext.metadata && metadataContext.metadata.contestId) || (state.contestWorkspace && state.contestWorkspace.contest && state.contestWorkspace.contest.id)) {
    contestPassword = state.contestPassword || "";
    if (!contestPassword) {
      contestPassword = await vscode.window.showInputBox({
        prompt: "如果比赛下载测试数据需要密码，请输入比赛密码",
        password: true,
        ignoreFocusOut: true
      }) || "";
    }
  }

  const archive = await client.downloadTestCases(problem.id || metadataContext.metadata.problemId, contestPassword || undefined);
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
  contestStatusBar.command = "xmuoj.reopenRecentContest";

  const state = {
    contestWorkspace: null,
    contestPassword: "",
    activeProblem: null,
    activeContest: null,
    user: null,
    lastSubmissionResult: context.globalState.get(LAST_SUBMISSION_RESULT_KEY, null),
    lastLocalReport: context.globalState.get(LAST_LOCAL_REPORT_KEY, null),
    submissionHistory: context.globalState.get(SUBMISSION_HISTORY_KEY, []),
    problemProgress: context.globalState.get(PROBLEM_PROGRESS_KEY, {}),
    recentContests: context.globalState.get(RECENT_CONTESTS_KEY, []),
    recentProblems: context.globalState.get(RECENT_PROBLEMS_KEY, []),
    resultPanel: null,
    baseUrl: client.baseUrl,
    currentSourcePath: null,
    workbenchLayout: context.globalState.get(WORKBENCH_LAYOUT_KEY, null)
  };
  state.persistenceHook = () => persistWorkbenchLayout(context, state);

  const treeProvider = new ProblemTreeDataProvider(state);
  const codeLensProvider = new XmuojCodeLensProvider();
  vscode.window.registerTreeDataProvider("xmuojExplorer", treeProvider);
  context.subscriptions.push(vscode.languages.registerCodeLensProvider([{ scheme: "file" }], codeLensProvider));

  updateStatusBars(state, userStatusBar, contestStatusBar, client);
  userStatusBar.show();
  contestStatusBar.show();

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (editor) => {
    if (!editor) {
      return;
    }
    const metadataEntry = await findProblemMetadata(editor.document.fileName);
    if (metadataEntry && metadataEntry.metadata) {
      await rememberSourceFile(context, state, editor.document.fileName);
      treeProvider.refresh();
    }
  }));

  client.getBootstrap().then((bootstrap) => {
    state.user = bootstrap.user;
    codeLensProvider.setUser(state.user);
    updateStatusBars(state, userStatusBar, contestStatusBar, client);
    treeProvider.refresh();
    refreshProblemPanel(state, client).catch(() => null);
    restoreWorkbenchLayout(context, client, state).then(() => treeProvider.refresh()).catch(() => null);
  }).catch(() => null);

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.configureBaseUrl", async () => {
    const baseUrl = await vscode.window.showInputBox({
      prompt: "请输入 XMUOJ 站点地址",
      value: client.baseUrl,
      ignoreFocusOut: true
    });
    if (!baseUrl) {
      return;
    }
    await client.setBaseUrl(baseUrl);
    updateStatusBars(state, userStatusBar, contestStatusBar, client);
    vscode.window.showInformationMessage(`XMUOJ 站点地址已设置为 ${baseUrl}`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.quickStart", async () => {
    try {
      await runQuickStartAction();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

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

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.reopenRecentContestByItem", async (item) => {
    if (!item) {
      return;
    }
    if (item.baseUrl !== client.baseUrl) {
      await client.setBaseUrl(item.baseUrl);
    }
    const contestPassword = item.require_password
      ? await vscode.window.showInputBox({ prompt: "请输入比赛密码", password: true, ignoreFocusOut: true })
      : "";
    try {
      const workspace = await loadContestWorkspace(client, state, treeProvider, item.id, contestPassword || "");
      state.recentContests = await saveRecentContest(context, workspace.contest, client.baseUrl);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.reopenRecentContest", async () => {
    const recent = context.globalState.get(RECENT_CONTESTS_KEY, []);
    if (!recent.length) {
      vscode.window.showInformationMessage("还没有最近打开过的比赛");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      recent.map(item => ({
        label: item.title,
        description: `#${item.id}`,
        detail: `${item.baseUrl}${item.require_password ? " · 需要密码" : ""}`,
        item
      })),
      { title: "重新打开最近比赛", ignoreFocusOut: true }
    );
    if (!pick) {
      return;
    }
    if (pick.item.baseUrl !== client.baseUrl) {
      await client.setBaseUrl(pick.item.baseUrl);
    }
    const contestPassword = pick.item.require_password
      ? await vscode.window.showInputBox({ prompt: "请输入比赛密码", password: true, ignoreFocusOut: true })
      : "";
    try {
      const workspace = await loadContestWorkspace(client, state, treeProvider, pick.item.id, contestPassword || "");
      state.recentContests = await saveRecentContest(context, workspace.contest, client.baseUrl);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      vscode.window.showInformationMessage(`已加载比赛：${workspace.contest.title}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
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
          description: `${contest.rule_type} · ${contest.status}`,
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
      const workspace = await loadContestWorkspace(client, state, treeProvider, pick.contest.id, contestPassword || "");
      state.recentContests = await saveRecentContest(context, workspace.contest, client.baseUrl);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      vscode.window.showInformationMessage(`已加载比赛：${workspace.contest.title}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.browseProblemset", async () => {
    const keyword = await vscode.window.showInputBox({
      prompt: "按题目标题或题号搜索公开题目",
      ignoreFocusOut: true
    });
    try {
      const problemData = await client.getProblemset({ keyword: keyword || undefined });
      if (!problemData.results.length) {
        vscode.window.showInformationMessage("没有找到符合条件的题目");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        problemData.results.map(problem => ({
          label: `${problem.display_id} ${problem.title}`,
          description: problem.difficulty,
          detail: (problem.languages || []).join(", "),
          problem
        })),
        { title: "选择一道公开题目", ignoreFocusOut: true }
      );
      if (!pick) {
        return;
      }
      state.contestWorkspace = null;
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
      const detail = await openProblemDetail(client, state, pick.problem, null, "");
      state.recentProblems = await saveRecentProblem(context, detail, client.baseUrl, null);
      treeProvider.refresh();
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
    try {
      const workspace = await loadContestWorkspace(client, state, treeProvider, contestId, contestPassword || "");
      state.recentContests = await saveRecentContest(context, workspace.contest, client.baseUrl);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
      vscode.window.showInformationMessage(`已加载比赛：${workspace.contest.title}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.refreshContest", async () => {
    if (!state.contestWorkspace) {
      vscode.window.showWarningMessage("当前还没有加载比赛");
      return;
    }
    try {
      await loadContestWorkspace(client, state, treeProvider, state.contestWorkspace.contest.id, state.contestPassword);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      await focusExplorerView();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
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
      state.recentProblems = await saveRecentProblem(context, detail, client.baseUrl, state.contestWorkspace ? state.contestWorkspace.contest : null);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.startWorkingOnProblem", async () => {
    try {
      await startWorkingOnProblem(context, client, state, outputChannel);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.reopenRecentProblemByItem", async (item) => {
    if (!item) {
      return;
    }
    if (item.baseUrl !== client.baseUrl) {
      await client.setBaseUrl(item.baseUrl);
    }
    let contestPassword = "";
    if (item.contestId) {
      state.contestWorkspace = null;
      if (item.contestRequirePassword) {
        contestPassword = await vscode.window.showInputBox({
          prompt: "请输入比赛密码",
          password: true,
          ignoreFocusOut: true
        }) || "";
      }
      try {
        await loadContestWorkspace(client, state, treeProvider, item.contestId, contestPassword);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
        return;
      }
    }
    try {
      const detail = await openProblemDetail(
        client,
        state,
        { id: item.problemId, display_id: item.displayId, title: item.title },
        state.contestWorkspace ? state.contestWorkspace.contest : null,
        contestPassword
      );
      state.recentProblems = await saveRecentProblem(context, detail, client.baseUrl, state.contestWorkspace ? state.contestWorkspace.contest : null);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.reopenRecentProblem", async () => {
    const recent = context.globalState.get(RECENT_PROBLEMS_KEY, []);
    if (!recent.length) {
      vscode.window.showInformationMessage("还没有最近打开过的题目");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      recent.map(item => ({
        label: `${item.displayId} ${item.title}`,
        description: item.contestTitle || "题库",
        detail: `${item.baseUrl}${item.contestRequirePassword ? " · 需要密码" : ""}`,
        item
      })),
      { title: "重新打开最近题目", ignoreFocusOut: true }
    );
    if (!pick) {
      return;
    }
    if (pick.item.baseUrl !== client.baseUrl) {
      await client.setBaseUrl(pick.item.baseUrl);
    }
    let contestPassword = "";
    if (pick.item.contestId) {
      state.contestWorkspace = null;
      if (pick.item.contestRequirePassword) {
        contestPassword = await vscode.window.showInputBox({
          prompt: "请输入比赛密码",
          password: true,
          ignoreFocusOut: true
        }) || "";
      }
      try {
        await loadContestWorkspace(client, state, treeProvider, pick.item.contestId, contestPassword);
      } catch (error) {
        vscode.window.showErrorMessage(error.message);
        return;
      }
    }
    try {
      const detail = await openProblemDetail(
        client,
        state,
        { id: pick.item.problemId, display_id: pick.item.displayId, title: pick.item.title },
        state.contestWorkspace ? state.contestWorkspace.contest : null,
        contestPassword
      );
      state.recentProblems = await saveRecentProblem(context, detail, client.baseUrl, state.contestWorkspace ? state.contestWorkspace.contest : null);
      updateStatusBars(state, userStatusBar, contestStatusBar, client);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.createProblemWorkspace", async () => {
    try {
      await startWorkingOnProblem(context, client, state, outputChannel);
      treeProvider.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.switchProblemLanguage", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("请先打开本地 XMUOJ 题目源文件，再切换语言");
      return;
    }
    try {
      const metadataContext = await getEditorProblemContext(client, editor.document);
      if (!metadataContext.metadata || !metadataContext.problemDir) {
        vscode.window.showWarningMessage("当前文件不在 XMUOJ 题目工作区内");
        return;
      }
      const detail = await client.getProblemWorkspace(
        metadataContext.metadata.problemId,
        metadataContext.metadata.contestId || undefined,
        state.contestPassword || undefined
      );
      const nextLanguage = await chooseLanguage(detail, metadataContext.metadata.language);
      if (!nextLanguage || nextLanguage === metadataContext.metadata.language) {
        return;
      }
      metadataContext.metadata.language = nextLanguage;
      metadataContext.metadata.sourceFile = getSourceFileName(nextLanguage);
      await writeProblemMetadata(metadataContext.problemDir, metadataContext.metadata);
      const sourcePath = path.join(metadataContext.problemDir, metadataContext.metadata.sourceFile);
      try {
        await fs.access(sourcePath);
      } catch (error) {
        const template = (detail.template && detail.template[nextLanguage]) || "";
        await fs.writeFile(sourcePath, template, "utf8");
      }
      const document = await vscode.workspace.openTextDocument(sourcePath);
      await vscode.window.showTextDocument(document, { preview: false });
      await refreshProblemPanel(state, client);
      vscode.window.showInformationMessage(`题目语言已切换为 ${nextLanguage}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.generateAiSolution", async () => {
    if (!isAdminUser(state.user)) {
      vscode.window.showWarningMessage("AI解题当前仅对管理员开放。");
      return;
    }
    const problem = await ensureProblemFromEditorContext(client, state);
    if (!problem) {
      vscode.window.showWarningMessage("请先打开一道题，再使用 AI解题。");
      return;
    }
    try {
      const content = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `AI 正在生成 ${problem.display_id} 的题解`,
        cancellable: false
      }, async () => generateAiSolutionContent(problem));
      const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: `# ${problem.display_id} ${problem.title}\n\n${content}`
      });
      await vscode.window.showTextDocument(document, { preview: false, viewColumn: getWorkspaceViewColumn() });
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.generateAiCode", async () => {
    if (!isAdminUser(state.user)) {
      vscode.window.showWarningMessage("AI代码当前仅对管理员开放。");
      return;
    }
    const problem = await ensureProblemFromEditorContext(client, state);
    if (!problem) {
      vscode.window.showWarningMessage("请先打开一道题，再使用 AI代码。");
      return;
    }
    try {
      let sourceContext = await resolveSourceContext(client, state);
      if (!sourceContext || !sourceContext.sourcePath) {
        await startWorkingOnProblem(context, client, state, outputChannel);
        sourceContext = await resolveSourceContext(client, state);
      }
      if (!sourceContext || !sourceContext.sourcePath) {
        vscode.window.showWarningMessage("没有可写入的本地题目源码文件，请先创建题目工作区。");
        return;
      }
      const language = sourceContext.metadataContext && sourceContext.metadataContext.metadata
        ? sourceContext.metadataContext.metadata.language
        : ((vscode.window.activeTextEditor ? inferLanguage(vscode.window.activeTextEditor.document) : null) || (problem.languages || [])[0]);
      const content = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `AI 正在生成 ${problem.display_id} 的 ${language} 代码`,
        cancellable: false
      }, async () => generateAiCodeContent(problem, language));
      await fs.writeFile(sourceContext.sourcePath, normalizeAiCodeOutput(content), "utf8");
      const document = await vscode.workspace.openTextDocument(sourceContext.sourcePath);
      await vscode.window.showTextDocument(document, { preview: false, viewColumn: getWorkspaceViewColumn() });
      await rememberSourceFile(context, state, sourceContext.sourcePath);
      vscode.window.showInformationMessage("AI代码已写入当前题目的源码文件。");
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.downloadTestCases", async () => {
    try {
      const saved = await ensureTestCasesAvailable(client, state, outputChannel);
      if (!saved) {
        return;
      }
      vscode.window.showInformationMessage(`测试数据已下载到 ${saved.extractedDir}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
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
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      const workspaceRoot = workspaceFolder ? workspaceFolder.uri.fsPath : await chooseWorkspaceRoot();
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
      const sourceContext = await resolveSourceContext(client, state);
      if (!sourceContext) {
        vscode.window.showWarningMessage("请先打开本地源文件，或者先为当前题目创建工作区再运行测试");
        return;
      }
      const { document, metadataContext, sourcePath } = sourceContext;
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
        const choice = await vscode.window.showInformationMessage(message, "立即提交", "继续修改");
        if (choice === "立即提交") {
          await vscode.commands.executeCommand("xmuoj.submitCurrentFile");
        }
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
    const sourceContext = await resolveSourceContext(client, state);
    if (!sourceContext) {
      vscode.window.showWarningMessage("请先打开要提交的源文件，或者先为当前题目创建工作区");
      return;
    }
    const { document, metadataContext, sourcePath, usedActiveEditor } = sourceContext;
    const problem = state.activeProblem;
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
    try {
      let contestPassword;
      const contestId = problem && state.contestWorkspace ? state.contestWorkspace.contest.id : metadataContext.metadata ? metadataContext.metadata.contestId : undefined;
      if (contestId) {
        contestPassword = state.contestPassword || undefined;
        if (!contestPassword) {
          contestPassword = await vscode.window.showInputBox({
            prompt: "如果比赛提交需要密码，请输入比赛密码",
            password: true,
            ignoreFocusOut: true
          }) || undefined;
        }
      }
      const submission = await client.submitSolution({
        problem_id: problemId,
        contest_id: contestId || undefined,
        contest_password: contestPassword,
        language,
        code: document.getText()
      });
      if (!usedActiveEditor) {
        outputChannel.appendLine(`提交时自动使用当前题目工作区源码：${sourcePath}`);
      }
      vscode.window.showInformationMessage(`已创建提交 ${submission.submission_id}，正在等待判题结果...`);
      const result = await waitForSubmission(client, submission.submission_id);
      await saveSubmissionHistory(context, state, result, {
        title: metadataContext.metadata ? metadataContext.metadata.title : (state.activeProblem ? state.activeProblem.title : ""),
        displayId: result.display_id || (metadataContext.metadata ? metadataContext.metadata.displayId : ""),
        language,
        baseUrl: metadataContext.metadata ? metadataContext.metadata.baseUrl || client.baseUrl : client.baseUrl,
        contestId: contestId || null,
        problemId
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
      await showSubmissionResultPanel(context, state, client, result);
      treeProvider.refresh();
      await refreshProblemPanel(state, client);
      await persistWorkbenchLayout(context, state);
      vscode.window.showInformationMessage(`判题结果：${result.result_label}`);
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showLastSubmissionResult", async () => {
    if (!state.lastSubmissionResult) {
      vscode.window.showInformationMessage("还没有最近的提交结果记录");
      return;
    }
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showLastLocalReport", async () => {
    if (!state.lastLocalReport) {
      vscode.window.showInformationMessage("还没有最近的本地验收报告");
      return;
    }
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.showResultPanel", async () => {
    if (!state.lastLocalReport && !state.lastSubmissionResult && !(state.submissionHistory && state.submissionHistory.length)) {
      vscode.window.showInformationMessage("还没有结果记录，先运行一次本地测试或提交代码");
      return;
    }
    await showResultPanel(state, client);
  }));

  context.subscriptions.push(vscode.commands.registerCommand("xmuoj.openSubmissionHistoryEntry", async (item) => {
    if (!item) {
      return;
    }
    state.lastSubmissionResult = Object.assign({}, item);
    await context.globalState.update(LAST_SUBMISSION_RESULT_KEY, state.lastSubmissionResult);
    await showResultPanel(state, client);
    treeProvider.refresh();
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
      state.recentProblems = await saveRecentProblem(context, detail, client.baseUrl, contest);
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

  context.subscriptions.push(outputChannel, userStatusBar, contestStatusBar);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};