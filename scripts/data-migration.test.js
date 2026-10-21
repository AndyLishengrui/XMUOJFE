/**
 * 本地数据整理（题库标记合并）纯函数测试。
 */
"use strict";

const assert = require("assert");
const dataMigration = require("../src/dataMigration");
const { isQuestionBankContest } = require("../src/siteApi");

function main() {
  console.log("data migration");
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  check("版本与存储键保持稳定", () => {
    assert.strictEqual(dataMigration.DATA_MIGRATION_VERSION, 2);
    assert.strictEqual(dataMigration.DATA_MIGRATION_KEY, "xmuoj.dataMigrationVersion");
    assert.strictEqual(dataMigration.CONTEST_METADATA_KEY, "xmuoj.contestMetadata.v1");
  });

  check("服务端列表只摘取判定需要的字段", () => {
    const map = dataMigration.buildContestMetadataMap([
      {
        id: 483,
        title: "公共课 PTA 题库",
        status: "0",
        is_question_bank: true,
        is_exam: false,
        contest_type: "Public",
        real_time_rank: true,
        require_password: false,
        description: "不应保存的大字段"
      },
      {
        id: 399,
        title: "实验一",
        is_question_bank: false,
        is_exam: false,
        contest_type: "Password Protected"
      },
      { title: "没有 id" }
    ]);
    assert.deepStrictEqual(Object.keys(map).sort(), ["399", "483"]);
    assert.strictEqual(map["483"].is_question_bank, true);
    assert.strictEqual(map["483"].is_exam, false);
    assert.strictEqual(map["483"].description, undefined, "描述等大字段不应进入索引");
    assert.strictEqual(map["399"].is_question_bank, false);
  });

  check("刷新已加载实验时服务端标记优先", () => {
    const entries = [{
      key: "http://xmuoj.com::483",
      contest: { id: 483, title: "公共课 PTA 题库", status: "0" }
    }];
    const merged = dataMigration.mergeLoadedContestMetadata(
      entries,
      { "483": { id: 483, is_question_bank: true, is_exam: false, title: "公共课 PTA 题库" } },
      { override: true }
    );
    assert.strictEqual(merged[0].contest.is_question_bank, true);
    assert.strictEqual(merged[0].contest.is_exam, false);
    assert.strictEqual(isQuestionBankContest(merged[0].contest), true);
    assert.notStrictEqual(merged[0], entries[0], "应返回新对象，便于判断是否有更新");
  });

  check("缺省合并不会覆盖已有的服务端标记", () => {
    const contest = { id: 483, title: "x", is_question_bank: false, is_exam: true };
    const merged = dataMigration.mergeContestMetadata(
      contest,
      { id: 483, is_question_bank: true, is_exam: false, title: "服务端标题" }
    );
    assert.strictEqual(merged.is_question_bank, false);
    assert.strictEqual(merged.is_exam, true);
    assert.strictEqual(merged.title, "x");
  });

  check("扫盘条目可用索引补齐题库判定", () => {
    const scanned = { id: 483, title: "公共课 PTA 题库", status: null };
    const merged = dataMigration.mergeContestMetadata(
      scanned,
      dataMigration.metadataForContest(
        { "483": { id: 483, is_question_bank: true, is_exam: false } },
        483
      )
    );
    assert.strictEqual(merged.is_question_bank, true);
    assert.strictEqual(isQuestionBankContest(merged), true);
  });

  check("缺少服务端判定的实验会被列出", () => {
    const entries = [
      { contest: { id: 1, title: "A" } },
      { contest: { id: 2, title: "B", is_question_bank: false, is_exam: false } },
      { contest: { id: 3, title: "C" } }
    ];
    const missing = dataMigration.contestsMissingClassification(
      entries,
      { "3": { id: 3, is_question_bank: true, is_exam: false } }
    );
    assert.deepStrictEqual(missing.sort(), ["1"]);
  });

  console.log(`data migration OK（${passed} 项）`);
}

try {
  main();
} catch (error) {
  console.error("data migration FAILED：", error && error.stack ? error.stack : error);
  process.exit(1);
}
