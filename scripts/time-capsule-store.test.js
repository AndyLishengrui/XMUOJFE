/**
 * 时间胶囊存储层测试：NDJSON → gzip 往返、索引、导入导出、崩溃恢复、上限。
 */
"use strict";

const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const capsule = require("../media/shared/capsule-format");
const { TimeCapsuleStore } = require("../src/timeCapsuleStore");

const FIXED_NOW = new Date("2026-10-20T10:30:00.000Z");

function makeStore(root, options = {}) {
  return new TimeCapsuleStore(root, Object.assign({ now: () => FIXED_NOW }, options));
}

const problem = { id: 11, displayId: "GW001", title: "输出第二个整数" };
const sampleEvents = [
  { t: 0, k: "cp", text: "" },
  { t: 120, k: "e", len: 0, c: [{ s: 0, e: 0, x: "#include <stdio.h>\n" }] },
  { t: 800, k: "cur", a: 21, b: 21 },
  { t: 1500, k: "m", name: "run", label: "本地测试", detail: { passed: 2, total: 3 } },
  { t: 2000, k: "cp", text: "#include <stdio.h>\nint main() { return 0; }\n" }
];

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-capsule-"));
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  console.log("time capsule store");

  try {
    const store = makeStore(root);
    await store.init();

    // 1) 录制 → 停止 → gzip 胶囊
    const recording = await store.create({
      id: "20261020T101500-ab12",
      problem,
      language: "Cpp",
      file: "main.cpp",
      startedAt: FIXED_NOW.toISOString()
    });
    assert.ok(recording.tempPath.endsWith(".ndjson"));
    await store.append(recording, sampleEvents.slice(0, 2));
    await store.append(recording, sampleEvents.slice(2));
    assert.strictEqual(recording.eventCount, sampleEvents.length);
    const stopped = await store.stop(recording, { durationMs: 2340, result: "accepted" });
    assert.strictEqual(stopped.meta.id, "20261020T101500-ab12");
    assert.strictEqual(stopped.meta.eventCount, sampleEvents.length);
    assert.strictEqual(stopped.meta.checkpointCount, 2);
    assert.strictEqual(stopped.meta.durationMs, 2340);
    assert.strictEqual(stopped.meta.result, "accepted");
    assert.strictEqual(stopped.meta.endedAt, FIXED_NOW.toISOString());
    assert.strictEqual(stopped.meta.problem.key, "id:11");
    assert.strictEqual(stopped.meta.attempt, 1);
    assert.deepStrictEqual(stopped.meta.stats, { edits: 0, runs: 0, submits: 0 });
    assert.ok(stopped.sizeBytes > 0);
    await assert.rejects(fs.access(recording.tempPath), /ENOENT/);

    const loaded = await store.read("20261020T101500-ab12");
    assert.strictEqual(loaded.meta.problem.displayId, "GW001");
    assert.deepStrictEqual(loaded.events, sampleEvents);
    const rebuilt = capsule.sliceAt(loaded.events, 900);
    assert.strictEqual(rebuilt.text, "#include <stdio.h>\n");
    check("录制 → gzip → 读取往返，检查点与时长正确", () => undefined);

    // 2) 索引
    const listed = await store.list();
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].id, "20261020T101500-ab12");
    assert.strictEqual(listed[0].result, "accepted");
    assert.strictEqual(listed[0].problemKey, "id:11");
    assert.strictEqual(listed[0].attempt, 1);
    assert.strictEqual(listed[0].sizeBytes, stopped.sizeBytes);
    check("index.json 记录胶囊摘要", () => undefined);

    await fs.unlink(path.join(root, "index.json"));
    const rebuiltList = await store.list();
    assert.strictEqual(rebuiltList.length, 1);
    assert.strictEqual(rebuiltList[0].id, "20261020T101500-ab12");
    check("index.json 丢失后从胶囊目录重建", () => undefined);

    // 3) 导出 / 导入 / 冲突 / 损坏
    const exportPath = path.join(root, "exports", "gw001.webm.xmuojcapsule");
    await store.exportCapsule("20261020T101500-ab12", exportPath);
    assert.strictEqual((await fs.stat(exportPath)).size > 0, true);

    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-capsule-import-"));
    const other = makeStore(otherRoot);
    const imported = await other.importCapsule(exportPath);
    assert.strictEqual(imported.meta.id, "20261020T101500-ab12");
    const importedRead = await other.read(imported.meta.id);
    assert.deepStrictEqual(importedRead.events, sampleEvents);
    const importedAgain = await other.importCapsule(exportPath);
    assert.strictEqual(importedAgain.meta.id, "20261020T101500-ab12-2");
    assert.deepStrictEqual((await other.read(importedAgain.meta.id)).events, sampleEvents);

    const brokenPath = path.join(otherRoot, "broken.xmuojcapsule");
    await fs.writeFile(brokenPath, "not gzip", "utf8");
    await assert.rejects(other.importCapsule(brokenPath), (error) => error.code === "EBADFILE");
    check("导出后可在另一个存储导入，冲突自动改名，损坏文件被拒绝", () => undefined);

    // 4) 崩溃恢复
    const crashed = await store.create({ id: "20261020T110000-cd34", problem, language: "Cpp", file: "main.cpp" });
    assert.strictEqual(crashed.meta.attempt, 2, "同一道题的下一次录制应递增尝试序号");
    await store.append(crashed, sampleEvents.slice(0, 3));
    const pending = await store.recover();
    const found = pending.find((entry) => entry.id === "20261020T110000-cd34");
    assert.ok(found, "应发现未完成的临时录制");
    assert.strictEqual(found.events, 3);
    const recovered = await store.recoverOne(found.file, { result: "partial" });
    assert.strictEqual(recovered.meta.eventCount, 3);
    assert.strictEqual(recovered.meta.result, "partial");
    assert.strictEqual((await store.recover()).length, 0);
    assert.strictEqual((await store.read("20261020T110000-cd34")).events.length, 3);
    check("未完成的临时录制可被发现并收尾", () => undefined);

    // 5) 大小 / 事件上限
    const limited = makeStore(root, { maxBytes: 200, maxEvents: 2 });
    const small = await limited.create({ id: "20261020T120000-ef56", problem, language: "Cpp", file: "main.cpp" });
    await assert.rejects(
      limited.append(small, [{ t: 1, k: "m", name: "run", label: "x".repeat(500) }]),
      (error) => error.code === "ELIMIT" && error.limit === "bytes"
    );
    const countLimited = makeStore(root, { maxBytes: 10 * 1024 * 1024, maxEvents: 2 });
    const counted = await countLimited.create({ id: "20261020T130000-aa11", problem, language: "Cpp", file: "main.cpp" });
    await countLimited.append(counted, sampleEvents.slice(0, 2));
    await assert.rejects(
      countLimited.append(counted, sampleEvents.slice(2)),
      (error) => error.code === "ELIMIT" && error.limit === "events"
    );
    check("达到大小或事件上限时抛出 ELIMIT", () => undefined);

    // 6) 删除与非法 id
    await store.deleteCapsule("20261020T110000-cd34");
    await assert.rejects(store.read("20261020T110000-cd34"), (error) => error.code === "ENOENT");
    await assert.rejects(store.read("../escape"), (error) => error.code === "EINVAL");
    assert.strictEqual((await store.list()).some((entry) => entry.id === "20261020T110000-cd34"), false);
    check("删除胶囊并拒绝越界 id", () => undefined);

    // 7) 升级整理：旧胶囊缺 problem.key / attempt 时，repairIndex 以文件为准补齐
    const repairRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xmuoj-capsule-repair-"));
    const repairStore = makeStore(repairRoot);
    await repairStore.init();
    const writeLegacyCapsule = async (id, problem, startedAt) => {
      const meta = {
        format: capsule.FORMAT,
        v: capsule.VERSION,
        id,
        problem,
        file: "main.py",
        startedAt
      };
      const events = [{ t: 0, k: "cp", text: "" }];
      const text = [JSON.stringify(meta)].concat(events.map((event) => JSON.stringify(event))).join("\n") + "\n";
      await fs.writeFile(path.join(repairRoot, `${id}.xmuojcapsule`), zlib.gzipSync(Buffer.from(text, "utf8")));
    };
    await writeLegacyCapsule("old-a", { displayId: "PTA1.1", title: "求积" }, "2026-10-01T00:00:00.000Z");
    await writeLegacyCapsule("old-b", { displayId: "ptA1.1", title: "求积" }, "2026-10-02T00:00:00.000Z");
    await writeLegacyCapsule("old-c", { id: 11, displayId: "GW001", title: "输出" }, "2026-10-03T00:00:00.000Z");
    // 故意写一份过期索引：幽灵条目应被移除，真实胶囊应重新计入。
    await fs.writeFile(
      path.join(repairRoot, "index.json"),
      JSON.stringify({ version: 1, entries: [{ id: "ghost", problem: { displayId: "X" } }] }),
      "utf8"
    );
    const repaired = await repairStore.repairIndex();
    assert.strictEqual(repaired.entries.length, 3, "应以胶囊文件为准重建索引");
    assert.strictEqual(repaired.entries.some((entry) => entry.id === "ghost"), false, "过期索引条目应被移除");
    const byId = new Map(repaired.entries.map((entry) => [entry.id, entry]));
    assert.strictEqual(byId.get("old-a").problemKey, "display:pta1.1");
    assert.strictEqual(byId.get("old-b").problemKey, "display:pta1.1");
    assert.strictEqual(byId.get("old-a").problem.key, "display:pta1.1");
    assert.strictEqual(byId.get("old-a").attempt, 1, "同题旧胶囊按开始时间补序号 1");
    assert.strictEqual(byId.get("old-b").attempt, 2, "同题旧胶囊按开始时间补序号 2");
    assert.strictEqual(byId.get("old-c").problemKey, "id:11");
    assert.strictEqual(byId.get("old-c").attempt, 1, "不同题目各自从 1 开始");
    const repairedAgain = await repairStore.repairIndex();
    assert.strictEqual(repairedAgain.entries.find((entry) => entry.id === "old-a").attempt, 1, "重复整理不应改变序号");
    assert.strictEqual(repairedAgain.entries.find((entry) => entry.id === "old-b").attempt, 2);
    await fs.rm(repairRoot, { recursive: true, force: true });
    check("旧胶囊索引整理：补齐题目键与尝试序号，移除过期条目", () => undefined);

    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(otherRoot, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => null);
    throw error;
  }

  console.log(`time capsule store OK（${passed} 项）`);
}

main().catch((error) => {
  console.error("time capsule store FAILED：", error && error.stack ? error.stack : error);
  process.exit(1);
});
