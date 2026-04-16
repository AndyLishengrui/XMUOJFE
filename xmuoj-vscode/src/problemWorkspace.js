const fs = require("fs/promises");
const path = require("path");

const vscode = require("vscode");
const AdmZip = require("adm-zip");

const METADATA_FILE_NAME = ".xmuoj.json";

const LANGUAGE_FILES = {
  C: "main.c",
  "C++": "main.cpp",
  Java: "Main.java",
  Python3: "main.py"
};

function slugifyTitle(title) {
  return String(title || "problem")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "problem";
}

function getSourceFileName(language) {
  return LANGUAGE_FILES[language] || "main.txt";
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

async function chooseWorkspaceRoot() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  if (workspaceFolders.length === 1) {
    return workspaceFolders[0].uri.fsPath;
  }
  if (workspaceFolders.length > 1) {
    const pick = await vscode.window.showQuickPick(
      workspaceFolders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
      { title: "选择保存 XMUOJ 题目文件的工作区目录", ignoreFocusOut: true }
    );
    if (pick) {
      return pick.folder.uri.fsPath;
    }
  }
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "选择题目工作区根目录"
  });
  return selected && selected[0] ? selected[0].fsPath : null;
}

function buildProblemDirectory(rootPath, problem, contest) {
  const scopeDir = contest ? `contest-${contest.id}` : "problemset";
  return path.join(rootPath, "xmuoj", scopeDir, `${problem.display_id}-${slugifyTitle(problem.title)}`);
}

async function ensureProblemWorkspace({ rootPath, problem, contest, language, baseUrl }) {
  const problemDir = buildProblemDirectory(rootPath, problem, contest);
  const samplesDir = path.join(problemDir, "samples");
  await fs.mkdir(samplesDir, { recursive: true });

  const sourceFileName = getSourceFileName(language);
  const sourceFilePath = path.join(problemDir, sourceFileName);
  const markdownPath = path.join(problemDir, "problem.md");
  const metadataPath = path.join(problemDir, METADATA_FILE_NAME);
  const template = (problem.template && problem.template[language]) || "";

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
    await fs.writeFile(sourceFilePath, template, "utf8");
  }

  const metadata = {
    version: 1,
    baseUrl,
    problemId: problem.id,
    contestId: contest ? contest.id : null,
    contestTitle: contest ? contest.title : null,
    displayId: problem.display_id,
    title: problem.title,
    language,
    sourceFile: sourceFileName,
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

  return { problemDir, sourceFilePath, metadataPath, metadata };
}

async function writeProblemMetadata(problemDir, metadata) {
  const metadataPath = path.join(problemDir, METADATA_FILE_NAME);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
  return metadataPath;
}

async function findProblemMetadata(startFilePath) {
  let currentDir = path.dirname(startFilePath);
  while (true) {
    const metadataPath = path.join(currentDir, METADATA_FILE_NAME);
    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      return { metadata, metadataPath };
    } catch (error) {
      if (error && error.code && error.code !== "ENOENT") {
        throw error;
      }
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
      note: `可在命令面板执行“XMUOJ：运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  if (language === "C++") {
    return {
      build: `mkdir -p ${buildDir} && c++ ${quotedSource} -O2 -std=c++14 -o ${buildDir}/main-cpp`,
      run: `mkdir -p ${buildDir} && c++ ${quotedSource} -O2 -std=c++14 -o ${buildDir}/main-cpp && ${buildDir}/main-cpp < ${quotedSample}`,
      note: `可在命令面板执行“XMUOJ：运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  if (language === "Java") {
    const className = path.basename(sourceFileName, path.extname(sourceFileName));
    return {
      build: `mkdir -p ${buildDir} && javac -encoding UTF-8 -d ${buildDir} ${quotedSource}`,
      run: `mkdir -p ${buildDir} && javac -encoding UTF-8 -d ${buildDir} ${quotedSource} && java -cp ${buildDir} ${className} < ${quotedSample}`,
      note: `可在命令面板执行“XMUOJ：运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  if (language === "Python3") {
    return {
      build: `python3 -m py_compile ${quotedSource}`,
      run: `python3 ${quotedSource} < ${quotedSample}`,
      note: `可在命令面板执行“XMUOJ：运行本地测试”，或直接查看 ${quotedExtracted} 与 ${quotedSamples} 下的测试数据`
    };
  }
  return {
    build: `echo 不支持的语言: ${language}`,
    run: `echo 不支持的语言: ${language}`,
    note: "可在命令面板执行“XMUOJ：运行本地测试”"
  };
}

async function createWorkspaceTasks(workspaceRoot, problemDir, metadata) {
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

  const relativeProblemDir = path.relative(workspaceRoot, problemDir).split(path.sep).join("/");
  const commands = buildShellCommands({
    sourceFileName: `${relativeProblemDir}/${metadata.sourceFile}`,
    language: metadata.language,
    extractedCaseDir: `${relativeProblemDir}/testcases/extracted`,
    samplesDir: `${relativeProblemDir}/samples`
  });
  const problemKey = `${metadata.displayId}-${metadata.language}`;
  tasksJson.tasks = tasksJson.tasks.filter(task => !String(task.label || "").includes(problemKey));
  tasksJson.tasks.push(
    {
      label: `XMUOJ Build ${problemKey}`,
      type: "shell",
      command: commands.build,
      options: { cwd: "${workspaceFolder}" },
      problemMatcher: []
    },
    {
      label: `XMUOJ Run Sample ${problemKey}`,
      type: "shell",
      command: commands.run,
      options: { cwd: "${workspaceFolder}" },
      problemMatcher: []
    },
    {
      label: `XMUOJ 说明 ${problemKey}`,
      type: "shell",
      command: `echo \"${commands.note.replace(/\"/g, '\\"')}\"`,
      options: { cwd: "${workspaceFolder}" },
      problemMatcher: []
    }
  );
  await fs.writeFile(tasksPath, JSON.stringify(tasksJson, null, 2), "utf8");
  return tasksPath;
}

module.exports = {
  METADATA_FILE_NAME,
  buildProblemDirectory,
  createWorkspaceTasks,
  chooseWorkspaceRoot,
  ensureProblemWorkspace,
  findProblemMetadata,
  getSourceFileName,
  saveTestCaseArchive,
  writeProblemMetadata
};