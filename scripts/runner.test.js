/**
 * runner 单元测试：解释器探测、启动失败中止、重复 stderr 折叠。
 * 全部在临时目录进行；Windows 与没有 python3 的机器会跳过依赖 PATH 的用例。
 */
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const runner = require("../src/runner");

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

function makeChannel() {
  const lines = [];
  return { lines, appendLine: (line) => lines.push(String(line)) };
}

async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function findRealPython3() {
  try {
    const output = execFileSync("/bin/sh", ["-c", "command -v python3"], { encoding: "utf8" }).trim();
    return output || null;
  } catch (error) {
    return null;
  }
}

/** 只在 fn 执行期间替换 PATH，避免影响同一进程里的其它用例。 */
async function withPath(pathValue, fn) {
  const original = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    return await fn();
  } finally {
    process.env.PATH = original;
  }
}

async function main() {
  console.log("runner");

  await check("runProcess 用 spawnError 标记无法启动的进程", async () => {
    const result = await runner.runProcess("xmuoj-definitely-missing-command", []);
    assert.strictEqual(result.spawnError, true);
    assert.strictEqual(result.exitCode, -1);
    assert.ok(result.stderr.includes("ENOENT"));
  });

  await check("runProcess 正常退出时不带 spawnError", async () => {
    const result = await runner.runProcess(process.execPath, ["-e", "process.stdout.write('hi')"]);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, "hi");
    assert.ok(!result.spawnError);
  });

  if (process.platform === "win32") {
    console.log(`  skip PATH 用例（Windows）`);
    console.log(`runner OK（${passed} 项）`);
    return;
  }

  const realPython = findRealPython3();
  if (!realPython) {
    console.log(" skip Python 用例（本机没有 python3）");
    console.log(`runner OK（${passed} 项）`);
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-runner-test-"));
  try {
    await check("python3 缺失时回退到 python", async () => {
      const binDir = path.join(root, "bin-python");
      const fake = path.join(binDir, "python");
      await writeFile(fake, [
        "#!/bin/sh",
        'if [ "$1" = "-V" ]; then echo "Python 3.12.0"; exit 0; fi',
        `exec ${realPython} "$@"`,
        ""
      ].join("\n"));
      await fs.chmod(fake, 0o755);
      const interpreter = await withPath(binDir, () => runner.resolvePythonInterpreter(binDir));
      assert.strictEqual(interpreter.command, "python");
    });

    await check("只认 Python 3：Python 2 会被拒绝", async () => {
      const binDir = path.join(root, "bin-py2");
      const fake = path.join(binDir, "python");
      await writeFile(fake, [
        "#!/bin/sh",
        'if [ "$1" = "-V" ]; then echo "Python 2.7.18" >&2; exit 0; fi',
        "exit 0",
        ""
      ].join("\n"));
      await fs.chmod(fake, 0o755);
      await assert.rejects(
        () => withPath(binDir, () => runner.resolvePythonInterpreter(binDir)),
        /未找到可用的 Python3 解释器/
      );
    });

    await check("没有可用解释器时提示已尝试的候选", async () => {
      const binDir = path.join(root, "bin-empty");
      await fs.mkdir(binDir, { recursive: true });
      await assert.rejects(
        () => withPath(binDir, () => runner.resolvePythonInterpreter(binDir)),
        (error) => {
          assert.ok(error.message.startsWith("未找到可用的 Python3 解释器"));
          assert.ok(error.message.includes("已尝试："));
          assert.ok(error.message.includes("重启 VS Code"));
          return true;
        }
      );
    });

    await check("正常用例全部通过", async () => {
      const dir = path.join(root, "pass");
      await writeFile(path.join(dir, "main.py"), "import sys\nprint(sys.stdin.read().strip())\n");
      await writeFile(path.join(dir, "cases", "1.in"), "42\n");
      await writeFile(path.join(dir, "cases", "1.out"), "42\n");
      const channel = makeChannel();
      const summary = await runner.runLocalCases({
        sourcePath: path.join(dir, "main.py"),
        language: "Python3",
        caseDir: path.join(dir, "cases"),
        outputChannel: channel
      });
      assert.strictEqual(summary.passed, 1);
      assert.strictEqual(summary.failed, 0);
    });

    await check("重复的 stderr 只完整打印一次", async () => {
      const dir = path.join(root, "dedupe");
      await writeFile(path.join(dir, "main.py"), "import sys\nsys.stderr.write('boom\\n')\nsys.exit(3)\n");
      for (const name of ["1", "2"]) {
        await writeFile(path.join(dir, "cases", `${name}.in`), "1\n");
        await writeFile(path.join(dir, "cases", `${name}.out`), "1\n");
      }
      const channel = makeChannel();
      const summary = await runner.runLocalCases({
        sourcePath: path.join(dir, "main.py"),
        language: "Python3",
        caseDir: path.join(dir, "cases"),
        outputChannel: channel
      });
      assert.strictEqual(summary.failed, 2);
      assert.strictEqual(channel.lines.filter((line) => line.startsWith("错误输出:")).length, 1);
      assert.ok(channel.lines.some((line) => line.includes("2 个测试点重复出现")));
    });

    await check("运行阶段解释器失效时立即中止，不逐点报错", async () => {
      const dir = path.join(root, "abort");
      const binDir = path.join(dir, "bin");
      const fake = path.join(binDir, "python3");
      // 探测时还可用，探测完就把自己变成不可执行，模拟“跑到一半解释器失效”。
      await writeFile(fake, [
        "#!/bin/sh",
        'if [ "$1" = "-V" ]; then echo "Python 3.12.0"; /bin/chmod -x "$0"; exit 0; fi',
        `exec ${realPython} "$@"`,
        ""
      ].join("\n"));
      await fs.chmod(fake, 0o755);
      await writeFile(path.join(dir, "main.py"), "print(1)\n");
      for (const name of ["1", "2", "3"]) {
        await writeFile(path.join(dir, "cases", `${name}.in`), "");
        await writeFile(path.join(dir, "cases", `${name}.out`), "1\n");
      }
      const channel = makeChannel();
      await assert.rejects(
        () => withPath(binDir, () => runner.runLocalCases({
          sourcePath: path.join(dir, "main.py"),
          language: "Python3",
          caseDir: path.join(dir, "cases"),
          outputChannel: channel
        })),
        /已中止本次测试/
      );
      assert.strictEqual(channel.lines.filter((line) => line.startsWith("[失败]")).length, 0);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log(`runner OK（${passed} 项）`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
