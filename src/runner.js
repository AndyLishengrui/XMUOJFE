const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

function normalizeOutput(output) {
  return String(output || "").replace(/\r\n/g, "\n").trimEnd();
}

function runProcess(command, args, { cwd, input, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "pipe" });
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
      finish({ exitCode: -1, stdout, stderr: `${stderr}\n进程执行超时，已超过 ${timeoutMs}ms`.trim() });
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      finish({ exitCode: -1, stdout, stderr: error.message });
    });
    child.on("close", exitCode => {
      finish({ exitCode, stdout, stderr });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
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
    return { command: "python3", args: [sourcePath], cwd: sourceDir };
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
  const execution = await prepareExecution(sourcePath, language, buildDir);
  const results = [];

  outputChannel.appendLine(`开始运行本地测试：共 ${casePairs.length} 组，文件 ${path.basename(sourcePath)}，语言 ${language}`);
  for (const casePair of casePairs) {
    const input = await fs.readFile(casePair.inputPath, "utf8");
    const expected = await fs.readFile(casePair.outputPath, "utf8");
    const run = await runProcess(execution.command, execution.args, {
      cwd: execution.cwd,
      input,
      timeoutMs: 10000
    });
    const passed = run.exitCode === 0 && normalizeOutput(run.stdout) === normalizeOutput(expected);
    outputChannel.appendLine(`[${passed ? "通过" : "失败"}] ${casePair.name}`);
    if (!passed) {
      outputChannel.appendLine(`期望输出:\n${expected}`);
      outputChannel.appendLine(`实际输出:\n${run.stdout}`);
      if (run.stderr) {
        outputChannel.appendLine(`错误输出:\n${run.stderr}`);
      }
    }
    results.push({
      name: casePair.name,
      passed,
      exitCode: run.exitCode,
      expected,
      actual: run.stdout,
      stdout: run.stdout,
      stderr: run.stderr
    });
  }

  return {
    total: results.length,
    passed: results.filter(item => item.passed).length,
    failed: results.filter(item => !item.passed).length,
    results
  };
}

module.exports = {
  runLocalCases
};