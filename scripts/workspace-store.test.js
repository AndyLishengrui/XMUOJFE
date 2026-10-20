/**
 * workspaceStore 单元测试：命名、身份、元数据 v2、索引、扫盘。
 * 全部在临时目录进行，不碰真实工作区；随 `npm run check` 运行。
 */
"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const store = require("../src/workspaceStore");

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

const BASE_URL = "http://xmuoj.com";

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function makeTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-store-test-"));
}

async function main() {
  console.log("workspaceStore");

  await check("中文标题保留、非法字符替换", () => {
    assert.strictEqual(store.slugifyTitle("求2数的积"), "求2数的积");
    assert.strictEqual(store.slugifyTitle("数组/求和: 入门?"), "数组-求和-入门");
    assert.strictEqual(store.slugifyTitle("  "), "problem");
    assert.strictEqual(store.slugifyTitle("a  b"), "a-b");
  });

  await check("目录名：展示号 + 标题，长度截断，Windows 保留名", () => {
    assert.strictEqual(
      store.buildProblemDirName({ display_id: "PTA1.1", title: "求2数的积" }),
      "PTA1.1-求2数的积"
    );
    const longName = store.buildProblemDirName({ display_id: "P01", title: "长".repeat(120) });
    assert.ok(Array.from(longName).length <= 72, longName);
    assert.ok(longName.startsWith("P01-"));
    assert.strictEqual(store.buildProblemDirName({ display_id: "CON", title: "x" }), "CON-x");
    assert.ok(store.buildProblemDirName({ display_id: "1/2", title: "x" }).includes("1-2"));
  });

  await check("身份键规范化", () => {
    assert.strictEqual(store.buildProblemIdentity("http://xmuoj.com/", 10220), "http://xmuoj.com::10220");
    assert.strictEqual(store.buildProblemIdentity("http://xmuoj.com", "10220"), "http://xmuoj.com::10220");
    assert.deepStrictEqual(store.parseProblemIdentity("http://xmuoj.com::10220"), {
      baseUrl: "http://xmuoj.com",
      problemId: 10220
    });
  });

  const root = await makeTempRoot();
  try {
    await check("v1 元数据升级 v2 保留 sourceFiles / createdAt", async () => {
      const dir = path.join(root, store.PROBLEMS_DIR_NAME, "PTA1.1-求2数的积");
      await writeJson(path.join(dir, store.METADATA_FILE_NAME), {
        version: 1,
        baseUrl: BASE_URL,
        problemId: 10220,
        contestId: 483,
        contestTitle: "公共课 PTA 题库",
        displayId: "PTA1.1",
        title: "求2数的积",
        language: "Python3",
        sourceFile: "main.py",
        sourceFiles: { Python3: "main.py", C: "main.c" },
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      const read = await store.readProblemMetadata(dir);
      assert.ok(read.metadata);
      assert.strictEqual(read.metadata.version, 2);
      assert.strictEqual(read.metadata.identity, "http://xmuoj.com::10220");
      assert.strictEqual(read.metadata.status, "active");
      assert.strictEqual(read.metadata.createdAt, "2026-01-01T00:00:00.000Z");
      assert.deepStrictEqual(read.metadata.sourceFiles, { Python3: "main.py", C: "main.c" });
    });

    await check("合并写入不重置 sourceFiles / createdAt", async () => {
      const dir = path.join(root, store.PROBLEMS_DIR_NAME, "PTA1.1-求2数的积");
      const before = await store.readProblemMetadata(dir);
      const next = await store.writeProblemMetadata(dir, {
        sourceFiles: { "C++": "main.cpp" },
        language: "C++",
        sourceFile: "main.cpp"
      });
      assert.strictEqual(next.createdAt, before.metadata.createdAt);
      assert.deepStrictEqual(next.sourceFiles, {
        Python3: "main.py",
        C: "main.c",
        "C++": "main.cpp"
      });
      assert.strictEqual(next.status, "active");
      const reread = await store.readProblemMetadata(dir);
      assert.deepStrictEqual(reread.metadata.sourceFiles, next.sourceFiles);
    });

    await check("占位元数据（无语言）推导为 placeholder", async () => {
      const dir = path.join(root, store.PROBLEMS_DIR_NAME, "JD001-集市算账");
      const metadata = await store.writeProblemMetadata(dir, {
        baseUrl: BASE_URL,
        problemId: 20001,
        displayId: "JD001",
        title: "集市算账",
        language: null,
        sourceFile: null
      });
      assert.strictEqual(metadata.status, "placeholder");
    });

    await check("同身份复用目录，不同身份冲突加 -p<id>", async () => {
      const first = await store.resolveProblemDir(root, { id: 10220, display_id: "PTA1.1", title: "求2数的积" }, null, {
        baseUrl: BASE_URL
      });
      assert.strictEqual(first.dirName, "PTA1.1-求2数的积");
      assert.strictEqual(first.reused, true);

      const other = await store.resolveProblemDir(root, { id: 99999, display_id: "PTA1.1", title: "求2数的积" }, null, {
        baseUrl: BASE_URL
      });
      assert.strictEqual(other.dirName, "PTA1.1-求2数的积-p99999");
      assert.strictEqual(other.reused, false);
    });

    await check("索引优先于重新计算的目录名", async () => {
      await store.writeProblemMetadata(path.join(root, "problems", "CUSTOM-改名了"), {
        baseUrl: BASE_URL,
        problemId: 30001,
        displayId: "CUSTOM",
        title: "改名了",
        language: "Python3",
        sourceFile: "main.py"
      });
      await store.updateWorkspaceIndexEntries(root, [
        {
          identity: store.buildProblemIdentity(BASE_URL, 30001),
          entry: store.buildIndexEntry("problems/CUSTOM-改名了", (
            await store.readProblemMetadata(path.join(root, "problems", "CUSTOM-改名了"))
          ).metadata)
        }
      ]);
      const resolved = await store.resolveProblemDir(root, { id: 30001, display_id: "P99", title: "另一个标题" }, null, {
        baseUrl: BASE_URL
      });
      assert.strictEqual(resolved.dirName, "CUSTOM-改名了");
      assert.strictEqual(resolved.reused, true);
    });

    await check("扫盘：新布局 + 旧 contest-*/problemsets 合并进索引", async () => {
      await writeJson(path.join(root, "contest-483", "PTA1.2-problem", ".xmuoj.json"), {
        version: 1,
        baseUrl: BASE_URL,
        problemId: 10221,
        contestId: 483,
        contestTitle: "公共课 PTA 题库",
        displayId: "PTA1.2",
        title: "阶乘",
        language: "Python3",
        sourceFile: "main.py",
        sourceFiles: { Python3: "main.py" },
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      await writeJson(path.join(root, "problemsets", "JD004-problem", ".xmuoj.json"), {
        version: 1,
        baseUrl: BASE_URL,
        problemId: 40001,
        displayId: "JD004",
        title: "集市算账",
        language: null,
        sourceFiles: {},
        createdAt: "2026-01-01T00:00:00.000Z"
      });
      await fs.mkdir(path.join(root, "contest-483", "no-metadata"), { recursive: true });

      const scanned = await store.scanWorkspace(root, { baseUrl: BASE_URL });
      assert.ok(scanned.index.entries["http://xmuoj.com::10221"]);
      assert.strictEqual(scanned.index.entries["http://xmuoj.com::10221"].dir, "contest-483/PTA1.2-problem");
      assert.strictEqual(scanned.index.entries["http://xmuoj.com::10221"].legacy, true);
      assert.ok(scanned.index.entries["http://xmuoj.com::40001"]);
      assert.ok(scanned.index.entries["http://xmuoj.com::10220"]);
      assert.strictEqual(scanned.legacy.length, 2);

      const groups = store.groupIndexEntriesByContest(scanned.index).sort((a, b) => a.key.localeCompare(b.key));
      const contestGroup = groups.find((group) => group.key === "483");
      assert.ok(contestGroup);
      assert.strictEqual(contestGroup.entries.length, 2);
      const publicGroup = groups.find((group) => group.key === "public");
      assert.ok(publicGroup);
      assert.strictEqual(publicGroup.entries.length, 3);
    });

    await check("ensureWorkspaceIndex 写盘后复用，force 时重扫", async () => {
      const first = await store.ensureWorkspaceIndex(root, { baseUrl: BASE_URL, force: true });
      assert.strictEqual(first.scanned, true);
      const second = await store.ensureWorkspaceIndex(root, { baseUrl: BASE_URL });
      assert.strictEqual(second.scanned, false);
      assert.ok(second.index.entries["http://xmuoj.com::10220"]);
      const forced = await store.ensureWorkspaceIndex(root, { baseUrl: BASE_URL, force: true });
      assert.strictEqual(forced.scanned, true);
    });

    await check("损坏元数据被跳过且不抛异常", async () => {
      await fs.mkdir(path.join(root, "problems", "BROKEN-x"), { recursive: true });
      await fs.writeFile(path.join(root, "problems", "BROKEN-x", ".xmuoj.json"), "{ not json", "utf8");
      const scanned = await store.scanWorkspace(root, { baseUrl: BASE_URL });
      assert.ok(scanned.unreadable.some((item) => item.dir === "problems/BROKEN-x"));
    });

    await check("根目录规范化：problems / problemsets / contest-*", () => {
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, "problems")), root);
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, "problems", "PTA1.1-求2数的积")), root);
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, "contest-483")), root);
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, "contest-483", "PTA1.1-problem")), root);
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, "problemsets")), root);
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, "other")), path.join(root, "other"));
      assert.strictEqual(store.normalizeWorkspaceRootPath(path.join(root, ".xmuoj")), root);
    });

    await check("旧布局识别", () => {
      const contest = store.getLegacyContainer(root, path.join(root, "contest-483", "PTA1.1-problem"));
      assert.deepStrictEqual(contest, { type: "contest", contestId: 483, container: "contest-483" });
      const problemset = store.getLegacyContainer(root, path.join(root, "problemsets", "JD004-problem"));
      assert.deepStrictEqual(problemset, { type: "problemset", contestId: null, container: "problemsets" });
      assert.strictEqual(store.getLegacyContainer(root, path.join(root, "problems", "PTA1.1-x")), null);
      assert.strictEqual(store.getLegacyContainer(root, path.join(os.tmpdir(), "outside")), null);
    });

    await check("原子写 JSON", async () => {
      const target = path.join(root, ".xmuoj", "atomic.json");
      await store.atomicWriteJson(target, { a: 1 });
      const parsed = JSON.parse(await fs.readFile(target, "utf8"));
      assert.deepStrictEqual(parsed, { a: 1 });
      const files = await fs.readdir(path.join(root, ".xmuoj"));
      assert.ok(!files.some((name) => name.includes(".tmp-")));
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log(`workspaceStore OK（${passed} 项）`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
