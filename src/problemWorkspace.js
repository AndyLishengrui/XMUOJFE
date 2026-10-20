const LOCAL_WORKSPACE_ROOT_KEY = "localWorkspaceRoot";
const LEGACY_WORKSPACE_FOLDERS_KEY = "workspaceFolders";

const LANGUAGE_FILES = {
  C: "main.c",
  "C++": "main.cpp",
  Java: "Main.java",
  Python3: "main.py"
};

const fs = require("fs/promises");
const path = require("path");

const vscode = require("vscode");
const AdmZip = require("adm-zip");

const store = require("./workspaceStore");

const METADATA_FILE_NAME = store.METADATA_FILE_NAME;
const PROBLEMS_DIR_NAME = store.PROBLEMS_DIR_NAME;

// 旧版公共题库目录名：仅用于识别/兼容，不再作为写入位置。
const PROBLEMSET_DIR_NAME = store.LEGACY_PROBLEMSET_DIR_NAME;

// 生成文件的排除规则：批量下载题库后，VS Code 若持续 watch/search 这些文件会卡死。
// 只做“排除监视与搜索”，不写 files.exclude，资源管理器里仍然可见。
const EXCLUDED_WATCH_PATTERNS = [
  "**/problem.md",
  "**/samples/**",
  "**/testcases/**",
  "**/.xmuoj-build/**",
  "**/.xmuoj/**"
];
const GITIGNORE_MARKER = "# XMUOJ generated";
const GITIGNORE_BLOCK = [
  GITIGNORE_MARKER,
  "samples/",
  "testcases/",
  ".xmuoj-build/",
  ".xmuoj/",
  ""
].join("\n");

let ignoreSettingsNoticeShown = false;
let workspaceFolderWarningShown = false;

/**
 * 向 <rootPath>/.vscode/settings.json 合并写入 files.watcherExclude / search.exclude。
 * 规则：只增不删、保留未知 key；文件不存在则创建；
 * 文件存在但无法按纯 JSON 解析（如带注释的 JSONC）时不动它，交由调用方提示。
 */
async function ensureWorkspaceIgnoreSettings(rootPath) {
  if (!rootPath) {
    return { changed: false };
  }
  const vscodeDir = path.join(rootPath, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");
  let settings = {};
  let fileExisted = false;
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    fileExisted = true;
    settings = JSON.parse(raw);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      settings = {};
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      settings = {};
    } else {
      // 存在但解析失败（JSONC 注释 / 损坏）：不改动用户的文件
      return { changed: false, skipped: true };
    }
  }

  let changed = false;
  for (const key of ["files.watcherExclude", "search.exclude"]) {
    const existing = settings[key];
    let target;
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      target = existing;
    } else if (existing === undefined) {
      target = {};
      settings[key] = target;
    } else {
      // 类型异常（如字符串），跳过该 key，避免破坏用户配置
      continue;
    }
    for (const pattern of EXCLUDED_WATCH_PATTERNS) {
      if (!(pattern in target)) {
        target[pattern] = true;
        changed = true;
      }
    }
  }

  if (!changed) {
    return { changed: false, fileExisted };
  }
  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  return { changed: true, fileExisted };
}

/**
 * 若 rootPath 位于某个 git 仓库内，向 <rootPath>/.gitignore 幂等追加生成文件规则，
 * 避免批量生成的样例/测试数据污染 git status。
 */
async function ensureGeneratedFilesGitignore(rootPath) {
  if (!rootPath) {
    return { changed: false };
  }
  // 向上查找 .git，确认处于仓库内（只读检查，绝不改父仓库的文件）
  let probe = path.resolve(rootPath);
  let inRepo = false;
  const seen = new Set();
  while (probe && !seen.has(probe)) {
    seen.add(probe);
    try {
      await fs.access(path.join(probe, ".git"));
      inRepo = true;
      break;
    } catch (_error) {
      /* keep walking */
    }
    const parent = path.dirname(probe);
    if (parent === probe) {
      break;
    }
    probe = parent;
  }
  if (!inRepo) {
    return { changed: false };
  }

  const gitignorePath = path.join(rootPath, ".gitignore");
  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf8");
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
  if (content.includes(GITIGNORE_MARKER)) {
    return { changed: false };
  }
  const base = content.replace(/\s*$/, "");
  const next = base ? `${base}\n\n${GITIGNORE_BLOCK}` : GITIGNORE_BLOCK;
  await fs.writeFile(gitignorePath, next, "utf8");
  return { changed: true };
}

/**
 * 拿到有效 rootPath 后的统一收尾：写索引排除、写 gitignore、防呆提示。
 * 任何一步失败都不阻断主流程。
 */
async function finalizeWorkspaceRoot(rootPath) {
  if (!rootPath) {
    return rootPath;
  }
  try {
    const result = await ensureWorkspaceIgnoreSettings(rootPath);
    if (result.changed && !ignoreSettingsNoticeShown) {
      ignoreSettingsNoticeShown = true;
      vscode.window.showInformationMessage(
        `已为「${rootPath}」配置 VS Code 索引排除：problem.md、样例与测试数据不再被监视和搜索（若仍在索引，重载窗口一次即可）。`
      );
    }
  } catch (error) {
    console.warn("XMUOJ: 写入索引排除配置失败:", error.message);
  }
  try {
    await ensureGeneratedFilesGitignore(rootPath);
  } catch (error) {
    console.warn("XMUOJ: 写入 .gitignore 失败:", error.message);
  }
  try {
    const folders = vscode.workspace.workspaceFolders || [];
    const pickedInsideOpenWorkspace = folders.some(
      (folder) => folder && folder.uri && folder.uri.fsPath && path.resolve(folder.uri.fsPath) === path.resolve(rootPath)
    );
    if (pickedInsideOpenWorkspace && !workspaceFolderWarningShown) {
      workspaceFolderWarningShown = true;
      vscode.window.showWarningMessage(
        "生成的题目与测试数据会写入当前打开的工程目录。建议以后为 XMUOJ 选择独立目录，减少对工程的干扰（本次可继续使用）。"
      );
    }
  } catch (_error) {
    /* ignore */
  }
  return rootPath;
}

function normalizeWorkspaceRootPath(inputPath) {
  return store.normalizeWorkspaceRootPath(inputPath);
}

function buildWorkspaceRootNormalizationMessage(selectedPath, normalizedPath) {
  return store.buildWorkspaceRootNormalizationMessage(selectedPath, normalizedPath);
}

function slugifyTitle(title) {
  return store.slugifyTitle(title);
}

async function migrateLegacyWorkspaceFoldersOnce() {
  try {
    const config = vscode.workspace.getConfiguration("xmuoj");
    const current = String(config.get(LOCAL_WORKSPACE_ROOT_KEY, "") || "").trim();
    if (current) {
      return;
    }
    const legacy = config.get(LEGACY_WORKSPACE_FOLDERS_KEY);
    if (!Array.isArray(legacy) || !legacy.length) {
      return;
    }
    const first = String(legacy[0] || "").trim();
    if (!first) {
      return;
    }
    try {
      await config.update(LOCAL_WORKSPACE_ROOT_KEY, first, vscode.ConfigurationTarget.Global);
      await config.update(LEGACY_WORKSPACE_FOLDERS_KEY, [], vscode.ConfigurationTarget.Global);
    } catch (error) {
      // 尝试使用完整路径更新
      await vscode.workspace.getConfiguration().update(`xmuoj.${LOCAL_WORKSPACE_ROOT_KEY}`, first, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration().update(`xmuoj.${LEGACY_WORKSPACE_FOLDERS_KEY}`, [], vscode.ConfigurationTarget.Global);
    }
  } catch (_error) {
    /* ignore */
  }
}

async function getLocalWorkspaceFolderHandles() {
  await migrateLegacyWorkspaceFoldersOnce();
  const root = String(vscode.workspace.getConfiguration("xmuoj").get(LOCAL_WORKSPACE_ROOT_KEY, "") || "").trim();
  if (!root) {
    return [];
  }
  try {
    await fs.access(root);
    return [{ uri: { fsPath: root } }];
  } catch (_error) {
    return [];
  }
}

function getSourceFileName(language) {
  return LANGUAGE_FILES[language] || "main.txt";
}

function getMetadataSourceFile(metadata, language) {
  if (!metadata) {
    return null;
  }
  const preferredLanguage = language || metadata.language;
  if (preferredLanguage && metadata.sourceFiles && metadata.sourceFiles[preferredLanguage]) {
    return metadata.sourceFiles[preferredLanguage];
  }
  if (preferredLanguage && metadata.language && preferredLanguage !== metadata.language) {
    return getSourceFileName(preferredLanguage);
  }
  if (metadata.sourceFile) {
    return metadata.sourceFile;
  }
  return preferredLanguage ? getSourceFileName(preferredLanguage) : null;
}

function setMetadataSourceFile(metadata, language, sourceFile) {
  return Object.assign({}, metadata, {
    language,
    sourceFile,
    status: "active",
    sourceFiles: Object.assign({}, metadata && metadata.sourceFiles ? metadata.sourceFiles : {}, {
      [language]: sourceFile
    })
  });
}

async function applyLanguageSwitch(problemDir, metadata, detail, nextLanguage) {
  const nextMetadata = setMetadataSourceFile(
    metadata,
    nextLanguage,
    getMetadataSourceFile(metadata, nextLanguage) || getSourceFileName(nextLanguage)
  );
  const written = await store.writeProblemMetadata(problemDir, {
    baseUrl: metadata && metadata.baseUrl,
    language: nextMetadata.language,
    sourceFile: nextMetadata.sourceFile,
    sourceFiles: nextMetadata.sourceFiles,
    status: "active"
  });
  Object.assign(nextMetadata, written);
  const sourcePath = path.join(problemDir, getMetadataSourceFile(nextMetadata, nextLanguage));
  const template = (detail && detail.template && detail.template[nextLanguage]) || "";

  if (!template) {
    vscode.window.showWarningMessage(`当前语言 ${nextLanguage} 没有可用的代码模板，将创建空文件。`);
  }

  try {
    await fs.access(sourcePath);
  } catch (error) {
    try {
      await fs.writeFile(sourcePath, template, "utf8");
      // 验证文件是否确实存在
      await fs.access(sourcePath);
    } catch (writeError) {
      throw new Error(`无法创建新语言源代码文件：${sourcePath}。错误：${writeError.message}`);
    }
  }
  await touchWorkspaceIndexForDir(problemDir, nextMetadata);
  return {
    metadata: nextMetadata,
    sourcePath
  };
}

/** 题目目录位于 {root}/problems/<题> 时推断根目录；其他布局返回空串。 */
function inferWorkspaceRoot(problemDir) {
  const parent = path.dirname(path.resolve(problemDir));
  return path.basename(parent) === PROBLEMS_DIR_NAME ? path.dirname(parent) : "";
}

async function touchWorkspaceIndexForDir(problemDir, metadata) {
  try {
    const root = inferWorkspaceRoot(problemDir);
    if (!root || !metadata) {
      return;
    }
    const relativeDir = store.toPosixRelative(root, problemDir);
    await store.updateWorkspaceIndexEntries(root, [
      {
        identity: metadata.identity,
        entry: store.buildIndexEntry(relativeDir, metadata),
        replace: true
      }
    ]);
  } catch (error) {
    console.warn("XMUOJ: 更新工作区索引失败:", error.message);
  }
}

function buildProblemMarkdown(problem, contest) {
  const lines = [
    `# ${problem.display_id} ${problem.title}`,
    "",
    contest ? `- 比赛：${contest.title}` : "- 范围：题库",
    `- 题型：${problem.rule_type}`,
    `- 难度：${problem.difficulty || "未知"}`,
    `- 语言：${(problem.languages || []).join(", ")}`,
    "",
    "## 题目描述",
    "",
    problem.description || "",
    "",
    "## 输入描述",
    "",
    problem.input_description || "",
    "",
    "## 输出描述",
    "",
    problem.output_description || "",
    ""
  ];

  if (problem.samples && problem.samples.length) {
    lines.push("## 样例", "");
    problem.samples.forEach((sample, index) => {
      lines.push(`### 样例 ${index + 1}`, "", "#### 输入", "", "```text", sample.input || "", "```", "", "#### 输出", "", "```text", sample.output || "", "```", "");
    });
  }

  if (problem.hint) {
    lines.push("## 提示", "", problem.hint, "");
  }

  return lines.join("\n");
}

async function chooseWorkspaceRoot(options = {}) {
  await migrateLegacyWorkspaceFoldersOnce();
  const forcePick = Boolean(options.forcePick);
  const config = vscode.workspace.getConfiguration("xmuoj");
  let configured = normalizeWorkspaceRootPath(config.get(LOCAL_WORKSPACE_ROOT_KEY, "") || "");
  const originalConfigured = String(config.get(LOCAL_WORKSPACE_ROOT_KEY, "") || "").trim();
  if (configured && configured !== originalConfigured) {
    try {
      await config.update(LOCAL_WORKSPACE_ROOT_KEY, configured, vscode.ConfigurationTarget.Global);
    } catch (_error) {
      try {
        await vscode.workspace.getConfiguration().update(`xmuoj.${LOCAL_WORKSPACE_ROOT_KEY}`, configured, vscode.ConfigurationTarget.Global);
      } catch (_error2) {
        /* ignore config write failure */
      }
    }
  }
  if (configured && !forcePick) {
    try {
      await fs.access(configured);
      return await finalizeWorkspaceRoot(configured);
    } catch (_error) {
      /* stale path, ask user again */
    }
  }
  let defaultUri;
  if (configured) {
    try {
      await fs.access(configured);
      defaultUri = vscode.Uri.file(configured);
    } catch (_error) {
      defaultUri = undefined;
    }
  }
  if (!defaultUri && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) {
    defaultUri = vscode.workspace.workspaceFolders[0].uri;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "选择 XMUOJ 本地工作区根目录",
    defaultUri
  });
  if (!selected || !selected[0]) {
    return null;
  }
  const selectedPath = selected[0].fsPath;
  const newPath = normalizeWorkspaceRootPath(selectedPath);
  const normalizationMessage = buildWorkspaceRootNormalizationMessage(selectedPath, newPath);
  if (normalizationMessage) {
    vscode.window.showInformationMessage(normalizationMessage);
  }
  try {
    // 尝试直接更新配置
    await config.update(LOCAL_WORKSPACE_ROOT_KEY, newPath, vscode.ConfigurationTarget.Global);
  } catch (error) {
    try {
      // 尝试使用完整路径更新
      const fullKey = `xmuoj.${LOCAL_WORKSPACE_ROOT_KEY}`;
      await vscode.workspace.getConfiguration().update(fullKey, newPath, vscode.ConfigurationTarget.Global);
    } catch (error2) {
      // 尝试使用工作区配置更新
      try {
        await vscode.workspace.getConfiguration().update(fullKey, newPath, vscode.ConfigurationTarget.Workspace);
      } catch (error3) {
        // 所有更新方法都失败，记录错误但继续执行
        console.warn('无法更新本地工作区配置:', error3.message);
      }
    }
  }
  return await finalizeWorkspaceRoot(newPath);
}

/**
 * 解析题目目录（v0.1.0 起统一为 {root}/problems/<题>）。
 * 异步：需要查索引并处理重名冲突；调用方必须 await。
 */
async function buildProblemDirectory(rootPath, problem, contest, options = {}) {
  const resolved = await store.resolveProblemDir(rootPath, problem, contest, {
    baseUrl: options.baseUrl || (problem && problem.baseUrl) || ""
  });
  return resolved.problemDir;
}

async function ensureProblemWorkspace({ rootPath, problem, contest, language, baseUrl }) {
  const problemDir = await buildProblemDirectory(rootPath, problem, contest, { baseUrl });
  const samplesDir = path.join(problemDir, "samples");
  await fs.mkdir(samplesDir, { recursive: true });

  const sourceFileName = getSourceFileName(language);
  const sourceFilePath = path.join(problemDir, sourceFileName);
  const markdownPath = path.join(problemDir, "problem.md");
  const metadataPath = path.join(problemDir, METADATA_FILE_NAME);
  const template = (problem.template && problem.template[language]) || "";

  if (!template) {
    vscode.window.showWarningMessage(`当前语言 ${language} 没有可用的代码模板，将创建空文件。`);
  }

  await fs.writeFile(markdownPath, buildProblemMarkdown(problem, contest), "utf8");
  for (let index = 0; index < (problem.samples || []).length; index += 1) {
    const sample = problem.samples[index];
    const sampleNumber = index + 1;
    await fs.writeFile(path.join(samplesDir, `${sampleNumber}.in`), sample.input || "", "utf8");
    await fs.writeFile(path.join(samplesDir, `${sampleNumber}.out`), sample.output || "", "utf8");
  }

  try {
    await fs.access(sourceFilePath);
  } catch (error) {
    try {
      await fs.writeFile(sourceFilePath, template, "utf8");
      // 验证文件是否确实存在
      await fs.access(sourceFilePath);
    } catch (writeError) {
      throw new Error(`无法创建源代码文件：${sourceFilePath}。错误：${writeError.message}`);
    }
  }

  // 合并写入：已有工作区的语言/源码/createdAt 不会被重置
  const metadata = await store.writeProblemMetadata(problemDir, {
    baseUrl,
    problemId: problem.id,
    contestId: contest ? contest.id : null,
    contestTitle: contest ? contest.title : null,
    displayId: problem.display_id,
    title: problem.title,
    language,
    sourceFile: sourceFileName,
    sourceFiles: { [language]: sourceFileName },
    status: "active"
  });
  await touchWorkspaceIndexForDir(problemDir, metadata);

  return { problemDir, sourceFilePath, metadataPath, metadata };
}

async function writeProblemMetadata(problemDir, metadata) {
  const written = await store.writeProblemMetadata(problemDir, metadata || {});
  await touchWorkspaceIndexForDir(problemDir, written);
  return written;
}

async function findProblemMetadata(startFilePath) {
  let currentDir = path.dirname(startFilePath);
  while (true) {
    const result = await store.readProblemMetadata(currentDir);
    if (result.metadata) {
      return { metadata: result.metadata, metadataPath: result.metadataPath };
    }
    // 损坏的 JSON：不再向上找（避免误认父目录），返回 null 由调用方降级
    if (result.corrupt) {
      return null;
    }
    // 到达工作区边界（problems 容器）后不再继续
    if (path.basename(currentDir) === PROBLEMS_DIR_NAME) {
      return null;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function saveTestCaseArchive(problemDir, archiveBuffer, fileName) {
  const testCasesRoot = path.join(problemDir, "testcases");
  const extractedDir = path.join(testCasesRoot, "extracted");
  const archivePath = path.join(testCasesRoot, fileName || "testcases.zip");

  await fs.mkdir(testCasesRoot, { recursive: true });
  await fs.writeFile(archivePath, archiveBuffer);
  await fs.rm(extractedDir, { recursive: true, force: true });
  await fs.mkdir(extractedDir, { recursive: true });

  const zip = new AdmZip(archiveBuffer);
  zip.extractAllTo(extractedDir, true);

  return { archivePath, extractedDir };
}

function buildShellCommands({ sourceFileName, language, extractedCaseDir, samplesDir }) {
  const quotedSource = sourceFileName.replace(/ /g, "\\ ");
  const quotedSample = `${samplesDir}/1.in`.replace(/ /g, "\\ ");
  const buildDir = ".xmuoj-build";
  const quotedExtracted = extractedCaseDir.replace(/ /g, "\\ ");
  const quotedSamples = samplesDir.replace(/ /g, "\\ ");
  if (language === "C") {
    return {
      build: `mkdir -p ${buildDir} && cc ${quotedSource} -O2 -std=c17 -o ${buildDir}/main-c`,
      run: `mkdir -p ${buildDir} && cc ${quotedSource} -O2 -std=c17 -o ${buildDir}/main-c && ${buildDir}/main-c < ${quotedSample}`,
      note: `可在命令面板执行“运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  if (language === "C++") {
    return {
      build: `mkdir -p ${buildDir} && c++ -x c++ ${quotedSource} -O2 -std=c++14 -o ${buildDir}/main-cpp`,
      run: `mkdir -p ${buildDir} && c++ -x c++ ${quotedSource} -O2 -std=c++14 -o ${buildDir}/main-cpp && ${buildDir}/main-cpp < ${quotedSample}`,
      note: `可在命令面板执行“运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  if (language === "Java") {
    const className = path.basename(sourceFileName, path.extname(sourceFileName));
    return {
      build: `mkdir -p ${buildDir} && javac -encoding UTF-8 -d ${buildDir} ${quotedSource}`,
      run: `mkdir -p ${buildDir} && javac -encoding UTF-8 -d ${buildDir} ${quotedSource} && java -cp ${buildDir} ${className} < ${quotedSample}`,
      note: `可在命令面板执行“运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  if (language === "Python3") {
    return {
      build: `python3 -m py_compile ${quotedSource}`,
      run: `python3 ${quotedSource} < ${quotedSample}`,
      note: `可在命令面板执行“运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  return {
    build: `echo 不支持的语言: ${language}`,
    run: `echo 不支持的语言: ${language}`,
    note: "可在命令面板执行“运行本地测试”"
  };
}

async function readWorkspaceTasksFile(workspaceRoot) {
  const vscodeDir = path.join(workspaceRoot, ".vscode");
  const tasksPath = path.join(vscodeDir, "tasks.json");
  await fs.mkdir(vscodeDir, { recursive: true });

  let tasksJson = { version: "2.0.0", tasks: [] };
  try {
    tasksJson = JSON.parse(await fs.readFile(tasksPath, "utf8"));
    tasksJson.version = tasksJson.version || "2.0.0";
    tasksJson.tasks = Array.isArray(tasksJson.tasks) ? tasksJson.tasks : [];
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
  return { tasksPath, tasksJson };
}

function applyProblemTasks(tasksJson, workspaceRoot, problemDir, metadata) {
  const relativeProblemDir = path.relative(workspaceRoot, problemDir).split(path.sep).join("/");
  const commands = buildShellCommands({
    sourceFileName: `${relativeProblemDir}/${metadata.sourceFile}`,
    language: metadata.language,
    extractedCaseDir: `${relativeProblemDir}/testcases/extracted`,
    samplesDir: `${relativeProblemDir}/samples`
  });
  // 以 problemId 为主键，避免跨实验 displayId 重名互相覆盖
  const problemKey = `p${metadata.problemId}-${metadata.language}`;
  const displayKey = `${metadata.displayId}-${metadata.language}`;
  const displaySuffix = metadata.displayId ? `（${metadata.displayId}）` : "";
  tasksJson.tasks = tasksJson.tasks.filter((task) => {
    const label = String(task.label || "");
    if (label.includes(problemKey)) {
      return false;
    }
    // 清理旧版本按 displayId 生成的标签（同一 displayId 重名时会被覆盖，这里一并清掉）
    if (displayKey && label.includes(displayKey)) {
      return false;
    }
    return true;
  });
  tasksJson.tasks.push(
    {
      label: `XMUOJ Build ${problemKey}${displaySuffix}`,
      type: "shell",
      command: commands.build,
      options: { cwd: "${workspaceFolder}" },
      problemMatcher: []
    },
    {
      label: `XMUOJ Run Sample ${problemKey}${displaySuffix}`,
      type: "shell",
      command: commands.run,
      options: { cwd: "${workspaceFolder}" },
      problemMatcher: []
    },
    {
      label: `XMUOJ 说明 ${problemKey}${displaySuffix}`,
      type: "shell",
      command: `echo \"${commands.note.replace(/\"/g, '\\"')}\"`,
      options: { cwd: "${workspaceFolder}" },
      problemMatcher: []
    }
  );
  return tasksJson;
}

async function createWorkspaceTasks(workspaceRoot, problemDir, metadata) {
  const { tasksPath, tasksJson } = await readWorkspaceTasksFile(workspaceRoot);
  applyProblemTasks(tasksJson, workspaceRoot, problemDir, metadata);
  await fs.writeFile(tasksPath, JSON.stringify(tasksJson, null, 2), "utf8");
  return tasksPath;
}

/**
 * 批量版本：一次读、一次写 tasks.json，避免批量生成时逐题重写触发 VS Code 反复监视。
 * entries: [{ problemDir, metadata }]
 */
async function createWorkspaceTasksBatch(workspaceRoot, entries) {
  if (!entries || !entries.length) {
    return null;
  }
  const { tasksPath, tasksJson } = await readWorkspaceTasksFile(workspaceRoot);
  for (const entry of entries) {
    if (entry && entry.problemDir && entry.metadata) {
      applyProblemTasks(tasksJson, workspaceRoot, entry.problemDir, entry.metadata);
    }
  }
  await fs.writeFile(tasksPath, JSON.stringify(tasksJson, null, 2), "utf8");
  return tasksPath;
}

function buildLegacyProblemDirectory(rootPath, problem, contest) {
  const scopeDir = contest ? `contest-${contest.id}` : PROBLEMSET_DIR_NAME;
  return path.join(rootPath, scopeDir, `${problem.display_id}-${slugifyTitleLegacy(problem.title)}`);
}

function slugifyTitleLegacy(title) {
  return String(title || "problem")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "problem";
}

async function readIndexForLookup(rootPath, baseUrl) {
  const index = await store.readWorkspaceIndex(rootPath);
  if (index.corrupt || !index.updatedAt) {
    const ensured = await store.ensureWorkspaceIndex(rootPath, { baseUrl });
    return ensured.index;
  }
  return index;
}

function findIndexEntryForProblem(index, problem, contest, baseUrl) {
  if (!index || !index.entries) {
    return null;
  }
  const identity = store.buildProblemIdentity(baseUrl, problem.id);
  if (index.entries[identity]) {
    return index.entries[identity];
  }
  const candidates = Object.values(index.entries).filter(
    (entry) => entry && String(entry.problemId) === String(problem.id)
  );
  if (!candidates.length) {
    return null;
  }
  if (contest) {
    const sameContest = candidates.find((entry) => String(entry.contestId) === String(contest.id));
    if (sameContest) {
      return sameContest;
    }
  }
  return candidates[0];
}

async function buildWorkspaceResult(rootPath, problemDir, metadataRead, entry) {
  const metadata = metadataRead.metadata;
  const sourceFileName = getMetadataSourceFile(metadata, metadata.language);
  return {
    workspaceRoot: rootPath,
    problemDir,
    metadataPath: metadataRead.metadataPath,
    metadata,
    sourceFilePath: sourceFileName ? path.join(problemDir, sourceFileName) : null,
    identity: metadata.identity,
    legacy: Boolean(entry && entry.legacy)
  };
}

/**
 * 查找题目已有的本地工作区。
 * 顺序：索引（身份）→ 旧布局规范路径 → 新布局规范目录名。
 * 旧布局命中时默认惰性迁移这一道题；树节点展开传 { migrate: false } 保持只读。
 */
async function findExistingProblemWorkspace(problem, contest, options = {}) {
  await migrateLegacyWorkspaceFoldersOnce();
  if (!problem || problem.id === undefined || problem.id === null) {
    return null;
  }
  const searchFolders = [];
  const handles = await getLocalWorkspaceFolderHandles();
  for (const folder of handles) {
    const workspaceRoot = folder && folder.uri ? folder.uri.fsPath : "";
    if (workspaceRoot) {
      searchFolders.push(workspaceRoot);
    }
  }

  for (const workspaceRoot of searchFolders) {
    const baseUrl = options.baseUrl || (problem && problem.baseUrl) || "";
    const index = await readIndexForLookup(workspaceRoot, baseUrl);
    const entry = findIndexEntryForProblem(index, problem, contest, baseUrl);

    if (entry && entry.dir) {
      let problemDir = path.join(workspaceRoot, ...String(entry.dir).split("/"));
      let metadataRead = await store.readProblemMetadata(problemDir, { baseUrl });
      if (metadataRead.metadata && String(metadataRead.metadata.problemId) === String(problem.id)) {
        let legacyFlag = Boolean(entry.legacy);
        if (entry.legacy && options.migrate !== false) {
          const migrated = await migrateSingleLegacyProblem(workspaceRoot, entry.dir, options);
          if (migrated && migrated.problemDir) {
            const nextRead = await store.readProblemMetadata(migrated.problemDir, { baseUrl });
            if (nextRead.metadata) {
              problemDir = migrated.problemDir;
              metadataRead = nextRead;
              legacyFlag = false;
            }
          }
        }
        return buildWorkspaceResult(workspaceRoot, problemDir, metadataRead, { legacy: legacyFlag });
      }
    }

    // 兼容回退：旧布局规范路径（索引尚未覆盖时）
    const legacyDir = buildLegacyProblemDirectory(workspaceRoot, problem, contest);
    const legacyRead = await store.readProblemMetadata(legacyDir, { baseUrl });
    if (legacyRead.metadata && String(legacyRead.metadata.problemId) === String(problem.id)) {
      const relativeDir = store.toPosixRelative(workspaceRoot, legacyDir);
      if (options.migrate !== false) {
        const migrated = await migrateSingleLegacyProblem(workspaceRoot, relativeDir, options);
        if (migrated && migrated.identity) {
          const nextRead = await store.readProblemMetadata(migrated.problemDir, { baseUrl });
          if (nextRead.metadata) {
            return buildWorkspaceResult(workspaceRoot, migrated.problemDir, nextRead, { legacy: false });
          }
        }
      }
      return buildWorkspaceResult(workspaceRoot, legacyDir, legacyRead, { legacy: true });
    }

    // 兼容回退：新布局按规范目录名（索引缺失/损坏时）
    const newDir = path.join(workspaceRoot, PROBLEMS_DIR_NAME, store.buildProblemDirName(problem));
    const newRead = await store.readProblemMetadata(newDir, { baseUrl });
    if (newRead.metadata && String(newRead.metadata.problemId) === String(problem.id)) {
      return buildWorkspaceResult(workspaceRoot, newDir, newRead, { legacy: false });
    }
  }
  return null;
}

function migratedEntryFlag(entry) {
  return { legacy: Boolean(entry && entry.legacy) };
}

async function migrateSingleLegacyProblem(workspaceRoot, relativeDir, options = {}) {
  try {
    const migration = require("./migration");
    const result = await migration.migrateSingleProblem(workspaceRoot, relativeDir, {
      baseUrl: options.baseUrl,
      isDirectoryOpen: options.isDirectoryOpen
    });
    if (!result || !result.moved || !result.problemDir) {
      return null;
    }
    return {
      problemDir: result.problemDir,
      identity: result.entry && result.entry.identity
    };
  } catch (error) {
    console.warn("XMUOJ: 惰性迁移失败，继续使用旧目录:", error.message);
    return null;
  }
}

module.exports = {
  METADATA_FILE_NAME,
  PROBLEMS_DIR_NAME,
  PROBLEMSET_DIR_NAME,
  buildProblemDirectory,
  buildLegacyProblemDirectory,
  buildProblemMarkdown,
  createWorkspaceTasks,
  createWorkspaceTasksBatch,
  ensureWorkspaceIgnoreSettings,
  ensureGeneratedFilesGitignore,
  chooseWorkspaceRoot,
  ensureProblemWorkspace,
  findExistingProblemWorkspace,
  findProblemMetadata,
  getMetadataSourceFile,
  getSourceFileName,
  applyLanguageSwitch,
  saveTestCaseArchive,
  setMetadataSourceFile,
  writeProblemMetadata,
  slugifyTitle,
  inferWorkspaceRoot,
  getLocalWorkspaceFolderHandles,
  migrateLegacyWorkspaceFoldersOnce
};
