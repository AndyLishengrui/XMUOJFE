const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

function normalizeOutput(output) {
  return String(output || "").replace(/\r\n/g, "\n").trimEnd();
}

const MAX_REPORT_TEXT_CHARS = 8000;

function truncateReportText(text) {
  const value = String(text || "");
  if (value.length <= MAX_REPORT_TEXT_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_REPORT_TEXT_CHARS)}\n…（已截断，完整内容见测试数据文件）`;
}

function runProcess(command, args, { cwd, input, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", windowsHide: true });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        exitCode: -1,
        stdout,
        stderr: `${stderr}\n进程执行超时，已超过 ${timeoutMs}ms`.trim(),
        timedOut: true
      });
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    // spawnError：进程根本没起来（解释器缺失、无执行权限、被杀毒软件拦截），
    // 要和“程序跑完但退出码非 0”区分开，避免把环境问题当成每个测试点的答案错误。
    child.on("error", error => {
      finish({ exitCode: -1, stdout, stderr: `${stderr}${error.message}`.trim(), spawnError: true });
    });
    child.on("close", exitCode => {
      finish({ exitCode, stdout, stderr });
    });

    // 进程没起来时 stdin 会被销毁，写入会抛 EPIPE；这不是学生代码的错误，直接忽略。
    child.stdin.on("error", () => {});
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * Python 解释器候选。Windows 上常见只有 `py -3` 或 `python`，没有 `python3`
 * （商店别名还会弹出安装页）；macOS / Linux 上 conda、pyenv 装好后也可能只对终端生效。
 * 一个候选都找不到时，应该在跑测试点之前就报错退出，而不是每个测试点各报一次。
 */
const PYTHON_CANDIDATES = [
  { command: "python3", args: [] },
  { command: "python", args: [] },
  { command: "py", args: ["-3"] }
];

function describeProbe(candidate, probe) {
  const label = [candidate.command, ...candidate.args].join(" ");
  if (probe.spawnError) {
    return `${label} → ${String(probe.stderr || "").trim() || "无法启动"}`;
  }
  if (probe.timedOut) {
    return `${label} → 探测超时`;
  }
  const output = `${probe.stdout || ""}${probe.stderr || ""}`.trim();
  return `${label} → ${probe.exitCode === 0 ? output || "版本未知" : `退出码 ${probe.exitCode}`}`;
}

/**
 * 选出一个可用的 Python3 解释器（每轮测试只探测一次）。
 * 只认 Python 3.x，避免把仍叫 `python` 的 Python2 当成 Python3 用。
 */
async function resolvePythonInterpreter(cwd) {
  const attempts = [];
  for (const candidate of PYTHON_CANDIDATES) {
    const probe = await runProcess(candidate.command, [...candidate.args, "-V"], { cwd, timeoutMs: 5000 });
    const output = `${probe.stdout || ""}${probe.stderr || ""}`;
    if (!probe.spawnError && probe.exitCode === 0 && /Python\s*3\./i.test(output)) {
      return { command: candidate.command, args: candidate.args.slice() };
    }
    attempts.push(describeProbe(candidate, probe));
  }
  throw new Error(
    [
      "未找到可用的 Python3 解释器，本地测试已中止。",
      "请先安装 Python 3，并确认在终端里能直接运行 `python3 -V`（Windows 可用 `py -3 -V`）；",
      "装好后请重启 VS Code（已开着的窗口不会重新读取 PATH）。",
      `已尝试：${attempts.join("；")}`
    ].join("\n")
  );
}

function buildSpawnFailureMessage(execution, run, language) {
  const detail = String(run.stderr || "").trim() || "未知原因";
  const summary = language === "Python3"
    ? "Python3 解释器不可用，已中止本次测试"
    : `无法启动 ${path.basename(execution.command)}，已中止本次测试`;
  return `${summary}（未继续运行剩余测试点）。\n${detail}`;
}

async function prepareExecution(sourcePath, language, buildDir) {
  await fs.mkdir(buildDir, { recursive: true });
  const sourceDir = path.dirname(sourcePath);
  if (language === "C") {
    const executable = path.join(buildDir, "main-c");
    const compile = await runProcess("cc", [sourcePath, "-O2", "-std=c17", "-o", executable], { cwd: sourceDir });
    if (compile.exitCode !== 0) {
      throw new Error(`编译失败\n${compile.stderr || compile.stdout}`.trim());
    }
    return { command: executable, args: [], cwd: sourceDir };
  }
  if (language === "C++") {
    const executable = path.join(buildDir, "main-cpp");
    const compile = await runProcess("c++", [sourcePath, "-O2", "-std=c++14", "-o", executable], { cwd: sourceDir });
    if (compile.exitCode !== 0) {
      throw new Error(`编译失败\n${compile.stderr || compile.stdout}`.trim());
    }
    return { command: executable, args: [], cwd: sourceDir };
  }
  if (language === "Java") {
    const className = path.basename(sourcePath, path.extname(sourcePath));
    const compile = await runProcess("javac", ["-encoding", "UTF-8", "-d", buildDir, sourcePath], { cwd: sourceDir });
    if (compile.exitCode !== 0) {
      throw new Error(`编译失败\n${compile.stderr || compile.stdout}`.trim());
    }
    return { command: "java", args: ["-cp", buildDir, className], cwd: sourceDir };
  }
  if (language === "Python3") {
    const interpreter = await resolvePythonInterpreter(sourceDir);
    return { command: interpreter.command, args: [...interpreter.args, sourcePath], cwd: sourceDir };
  }
  throw new Error(`暂不支持 ${language} 的本地运行`);
}

async function findCasePairs(caseDir) {
  const entries = await fs.readdir(caseDir);
  const inputs = entries.filter(name => name.endsWith(".in")).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  return inputs
    .filter(inputName => entries.includes(inputName.replace(/\.in$/, ".out")))
    .map(inputName => ({
      name: inputName.replace(/\.in$/, ""),
      inputPath: path.join(caseDir, inputName),
      outputPath: path.join(caseDir, inputName.replace(/\.in$/, ".out"))
    }));
}

async function runLocalCases({ sourcePath, language, caseDir, outputChannel }) {
  const casePairs = await findCasePairs(caseDir);
  if (!casePairs.length) {
    throw new Error(`在 ${caseDir} 下没有找到成对的 .in/.out 测试文件`);
  }

  const buildDir = path.join(path.dirname(sourcePath), ".xmuoj-build");
  // 编译与解释器探测都在打印任何测试结果之前完成：环境有问题时只报一次，不刷屏。
  const execution = await prepareExecution(sourcePath, language, buildDir);
  const results = [];
  // 同一段 stderr 可能每个测试点都重复一遍（比如每点都崩溃）。完整内容只打印第一次。
  const stderrRepeat = new Map();

  outputChannel.appendLine(`开始运行本地测试：共 ${casePairs.length} 组，文件 ${path.basename(sourcePath)}，语言 ${language}`);
  for (const casePair of casePairs) {
    const input = await fs.readFile(casePair.inputPath, "utf8");
    const expected = await fs.readFile(casePair.outputPath, "utf8");
    const run = await runProcess(execution.command, execution.args, {
      cwd: execution.cwd,
      input,
      timeoutMs: 10000
    });
    if (run.spawnError) {
      throw new Error(buildSpawnFailureMessage(execution, run, language));
    }
    const passed = run.exitCode === 0 && normalizeOutput(run.stdout) === normalizeOutput(expected);
    outputChannel.appendLine(`[${passed ? "通过" : "失败"}] ${casePair.name}`);
    if (!passed) {
      outputChannel.appendLine(`期望输出:\n${expected}`);
      outputChannel.appendLine(`实际输出:\n${run.stdout}`);
      if (run.stderr) {
        const key = run.stderr.trim();
        const repeat = stderrRepeat.get(key) || { count: 0, printed: false };
        repeat.count += 1;
        if (!repeat.printed) {
          outputChannel.appendLine(`错误输出:\n${run.stderr}`);
          repeat.printed = true;
        }
        stderrRepeat.set(key, repeat);
      }
    }
    results.push({
      name: casePair.name,
      passed,
      exitCode: run.exitCode,
      // 只有失败点需要输入用于复现；截断避免报告持久化到 globalState 时过大。
      input: passed ? "" : truncateReportText(input),
      expected,
      actual: run.stdout,
      stdout: run.stdout,
      stderr: run.stderr
    });
  }

  const repeatedCount = [...stderrRepeat.values()]
    .filter(item => item.count > 1)
    .reduce((total, item) => total + item.count, 0);
  if (repeatedCount) {
    outputChannel.appendLine(`错误输出在 ${repeatedCount} 个测试点重复出现，相同内容已折叠。`);
  }

  return {
    total: results.length,
    passed: results.filter(item => item.passed).length,
    failed: results.filter(item => !item.passed).length,
    results
  };
}

module.exports = {
  runLocalCases,
  // 导出给测试直接驱动；扩展代码只使用 runLocalCases。
  runProcess,
  resolvePythonInterpreter
};
