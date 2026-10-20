/**
 * migration 单元测试：计划、执行、清单、回滚、锁、跨设备复制校验。
 * 全部在临时目录进行，不碰真实工作区；随 `npm run check` 运行。
 */
"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const migration = require("../src/migration");
const store = require("../src/workspaceStore");

const BASE_URL = "http://xmuoj.com";

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

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeV1Problem(root, relativeDir, metadata, files = {}) {
  const dir = path.join(root, relativeDir);
  await writeJson(path.join(dir, ".xmuoj.json"), Object.assign({
    version: 1,
    baseUrl: BASE_URL,
    language: "Python3",
    sourceFile: "main.py",
    sourceFiles: { Python3: "main.py" },
    createdAt: "2026-01-01T00:00:00.000Z"
  }, metadata));
  await fs.mkdir(path.join(dir, "samples"), { recursive: true });
  await fs.writeFile(path.join(dir, "main.py"), files.source || "print(1)\n", "utf8");
  await fs.writeFile(path.join(dir, "samples", "1.in"), "1\n", "utf8");
  await fs.writeFile(path.join(dir, "samples", "1.out"), "1\n", "utf8");
  return dir;
}

async function listRelative(root) {
  const output = [];
  async function walk(dir, prefix) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      output.push(rel);
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      }
    }
  }
  await walk(root, "");
  return output.sort();
}

async function main() {
  console.log("migration");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-migration-test-"));

  try {
    const movedSource = await writeV1Problem(root, "contest-483/PTA1.1-2", {
      problemId: 10220,
      contestId: 483,
      contestTitle: "公共课 PTA 题库",
      displayId: "PTA1.1",
      title: "求2数的积"
    });
    const publicSource = await writeV1Problem(root, "problemsets/JD001-problem", {
      problemId: 20001,
      displayId: "JD001",
      title: "集市算账"
    });
    await fs.mkdir(path.join(root, "contest-483", "no-metadata"), { recursive: true });
    await fs.writeFile(path.join(root, "contest-483", "no-metadata", "main.py"), "x", "utf8");
    await fs.symlink(movedSource, path.join(root, "contest-483", "symlink-problem"));
    const openSource = await writeV1Problem(root, "contest-483/PTA1.3-开放中", {
      problemId: 10222,
      contestId: 483,
      displayId: "PTA1.3",
      title: "开放中"
    });

    await check("迁移锁：第二个持有者被拒绝，释放后可再获取", async () => {
      const first = await migration.acquireMigrationLock(root);
      assert.strictEqual(first.acquired, true);
      const second = await migration.acquireMigrationLock(root);
      assert.strictEqual(second.acquired, false);
      assert.ok(second.holder && second.holder.pid === process.pid);
      await migration.releaseMigrationLock(root);
      const third = await migration.acquireMigrationLock(root);
      assert.strictEqual(third.acquired, true);
      await migration.releaseMigrationLock(root);
    });

    await check("迁移计划：正常移动 / 跳过无元数据 / 符号链接 / 编辑中打开", async () => {
      const plan = await migration.planMigration(root, {
        baseUrl: BASE_URL,
        isDirectoryOpen: (dir) => path.resolve(dir) === path.resolve(openSource)
      });
      const byFrom = new Map(plan.entries.map((entry) => [entry.from, entry]));
      assert.strictEqual(byFrom.get("contest-483/PTA1.1-2").action, "move");
      assert.strictEqual(byFrom.get("contest-483/PTA1.1-2").to, "problems/PTA1.1-求2数的积");
      assert.strictEqual(byFrom.get("problemsets/JD001-problem").action, "move");
      assert.strictEqual(byFrom.get("contest-483/no-metadata").reason, "no-metadata");
      assert.strictEqual(byFrom.get("contest-483/symlink-problem").reason, "symlink");
      assert.strictEqual(byFrom.get("contest-483/PTA1.3-开放中").reason, "open-in-editor");
      assert.deepStrictEqual(plan.summary, { move: 2, skip: 3, duplicate: 0 });
    });

    await check("执行迁移：目录移动、元数据升级 v2、备份、清单", async () => {
      const result = await migration.ensureWorkspaceMigration(root, {
        baseUrl: BASE_URL,
        isDirectoryOpen: (dir) => path.resolve(dir) === path.resolve(openSource)
      });
      assert.strictEqual(result.moved, 2);
      assert.ok(!(await store.pathExists(movedSource)), "旧目录应已移走");
      assert.ok(!(await store.pathExists(publicSource)), "旧目录应已移走");
      const targetDir = path.join(root, "problems", "PTA1.1-求2数的积");
      const read = await store.readProblemMetadata(targetDir);
      assert.strictEqual(read.metadata.version, 2);
      assert.strictEqual(read.metadata.identity, "http://xmuoj.com::10220");
      assert.strictEqual(read.metadata.contestId, 483);
      assert.strictEqual(read.metadata.title, "求2数的积");
      assert.ok(await store.pathExists(path.join(root, ".xmuoj", "backup-v1", "10220.json")));
      assert.ok(await store.pathExists(path.join(root, ".xmuoj", "migration.json")));
      assert.ok(await store.pathExists(path.join(root, ".xmuoj", "migration.log.jsonl")));
      const manifest = await migration.readMigrationManifest(root);
      assert.strictEqual(manifest.entries.filter((entry) => entry.status === "moved").length, 2);
      assert.ok(manifest.completedAt);
      // 仍有未迁移内容的 contest-483 不应被删除
      assert.ok(await store.pathExists(path.join(root, "contest-483")));
      // problemsets 已空，应被清理
      assert.ok(!(await store.pathExists(path.join(root, "problemsets"))));
      assert.ok(manifest.removedParents.includes("problemsets"));
      const index = await store.readWorkspaceIndex(root);
      assert.strictEqual(index.entries["http://xmuoj.com::10220"].dir, "problems/PTA1.1-求2数的积");
      assert.ok(!index.entries["http://xmuoj.com::10220"].legacy);
    });

    await check("重复执行幂等：不再产生移动", async () => {
      const again = await migration.ensureWorkspaceMigration(root, {
        baseUrl: BASE_URL,
        isDirectoryOpen: (dir) => path.resolve(dir) === path.resolve(openSource)
      });
      assert.strictEqual(again.moved || 0, 0);
      assert.ok(!(again.plan.entries || []).some((entry) => entry.action === "move"));
    });

    await check("回滚：目录移回旧位置，索引标记 legacy", async () => {
      const result = await migration.rollbackMigration(root);
      assert.strictEqual(result.rolledBack, 2);
      assert.ok(await store.pathExists(path.join(movedSource, "main.py")));
      assert.ok(await store.pathExists(path.join(publicSource, "main.py")));
      assert.ok(!(await store.pathExists(path.join(root, "problems", "PTA1.1-求2数的积"))));
      const index = await store.readWorkspaceIndex(root);
      assert.strictEqual(index.entries["http://xmuoj.com::10220"].dir, "contest-483/PTA1.1-2");
      const manifest = await migration.readMigrationManifest(root);
      assert.strictEqual(manifest.entries.filter((entry) => entry.status === "rolled-back").length, 2);
    });

    await check("目标被改动时回滚跳过", async () => {
      // 再次迁移，然后修改目标目录，再回滚
      const result = await migration.ensureWorkspaceMigration(root, {
        baseUrl: BASE_URL,
        isDirectoryOpen: (dir) => path.resolve(dir) === path.resolve(openSource)
      });
      assert.strictEqual(result.moved, 2);
      const targetDir = path.join(root, "problems", "PTA1.1-求2数的积");
      await fs.writeFile(path.join(targetDir, "extra.txt"), "改过了", "utf8");
      const rollback = await migration.rollbackMigration(root);
      assert.strictEqual(rollback.rolledBack, 1);
      assert.ok(rollback.failed.some((item) => item.reason === "target-modified"));
      assert.ok(await store.pathExists(path.join(targetDir, "extra.txt")));
    });

    await check("冲突：新布局已有同一身份 → duplicate，旧目录保留", async () => {
      const conflictRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-migration-dup-"));
      try {
        await store.writeProblemMetadata(path.join(conflictRoot, "problems", "PTA1.1-求2数的积"), {
          baseUrl: BASE_URL,
          problemId: 10220,
          displayId: "PTA1.1",
          title: "求2数的积",
          language: "Python3",
          sourceFile: "main.py"
        });
        await writeV1Problem(conflictRoot, "contest-483/PTA1.1-2", {
          problemId: 10220,
          contestId: 483,
          displayId: "PTA1.1",
          title: "求2数的积"
        });
        const plan = await migration.planMigration(conflictRoot, { baseUrl: BASE_URL });
        assert.strictEqual(plan.entries[0].action, "duplicate");
        const result = await migration.ensureWorkspaceMigration(conflictRoot, { baseUrl: BASE_URL });
        assert.strictEqual(result.moved || 0, 0);
        assert.strictEqual(result.duplicate, 1);
        assert.ok(await store.pathExists(path.join(conflictRoot, "contest-483", "PTA1.1-2")));
      } finally {
        await fs.rm(conflictRoot, { recursive: true, force: true });
      }
    });

    await check("跨设备复制校验：copyTree + verifyCopy 一致", async () => {
      const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-migration-copy-"));
      try {
        const source = await writeV1Problem(copyRoot, "src/PTA1.1-2", {
          problemId: 10220,
          contestId: 483,
          displayId: "PTA1.1",
          title: "求2数的积"
        });
        const target = path.join(copyRoot, "dst");
        await migration.copyTree(source, target);
        const before = await listRelative(source);
        const after = await listRelative(target);
        assert.deepStrictEqual(after, before);
        const verified = await migration.verifyCopy(source, target);
        assert.strictEqual(verified.ok, true);
        await fs.writeFile(path.join(target, "samples", "1.out"), "被改坏\n", "utf8");
        const broken = await migration.verifyCopy(source, target);
        assert.strictEqual(broken.ok, false);
      } finally {
        await fs.rm(copyRoot, { recursive: true, force: true });
      }
    });

    await check("副本目标被占用时改名为 -p<id> 后缀", async () => {
      const suffixRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-migration-suffix-"));
      try {
        await store.writeProblemMetadata(path.join(suffixRoot, "problems", "PTA1.1-求2数的积"), {
          baseUrl: BASE_URL,
          problemId: 55555,
          displayId: "PTA1.1",
          title: "求2数的积",
          language: "Python3",
          sourceFile: "main.py"
        });
        await writeV1Problem(suffixRoot, "contest-483/PTA1.1-2", {
          problemId: 10220,
          contestId: 483,
          displayId: "PTA1.1",
          title: "求2数的积"
        });
        const plan = await migration.planMigration(suffixRoot, { baseUrl: BASE_URL });
        assert.strictEqual(plan.entries[0].action, "move");
        assert.strictEqual(plan.entries[0].to, "problems/PTA1.1-求2数的积-p10220");
        const result = await migration.ensureWorkspaceMigration(suffixRoot, { baseUrl: BASE_URL });
        assert.strictEqual(result.moved, 1);
        assert.ok(await store.pathExists(path.join(suffixRoot, "problems", "PTA1.1-求2数的积-p10220", "main.py")));
      } finally {
        await fs.rm(suffixRoot, { recursive: true, force: true });
      }
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  console.log(`migration OK（${passed} 项）`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
