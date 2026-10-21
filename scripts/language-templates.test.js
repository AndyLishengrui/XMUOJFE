/**
 * 语言模板测试：C++ 不再使用 macOS 不可用的 <bits/stdc++.h>。
 */
"use strict";

const assert = require("assert");
const {
  CPP_HEADERS,
  LOCAL_LANGUAGE_TEMPLATES,
  replaceUniversalHeader
} = require("../src/languageTemplates");

function main() {
  let passed = 0;
  const check = (name, fn) => {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  };

  console.log("language templates");

  check("C++ 模板使用三个标准头且不含万能头", () => {
    const cpp = LOCAL_LANGUAGE_TEMPLATES["C++"];
    assert.ok(cpp.includes("#include <iostream>"));
    assert.ok(cpp.includes("#include <algorithm>"));
    assert.ok(cpp.includes("#include <cstring>"));
    assert.ok(cpp.includes("int main()"));
    assert.strictEqual(cpp.includes("bits/stdc++.h"), false);
    assert.deepStrictEqual(CPP_HEADERS, [
      "#include <iostream>",
      "#include <algorithm>",
      "#include <cstring>"
    ]);
  });

  check("其他语言模板都有入口结构", () => {
    assert.ok(LOCAL_LANGUAGE_TEMPLATES.C.includes("int main(void)"));
    assert.ok(LOCAL_LANGUAGE_TEMPLATES.Java.includes("public class Main"));
    assert.ok(LOCAL_LANGUAGE_TEMPLATES.Java.includes("public static void main"));
    assert.ok(LOCAL_LANGUAGE_TEMPLATES.Python3.includes("def main():"));
    assert.ok(LOCAL_LANGUAGE_TEMPLATES.Python3.includes("__main__"));
  });

  check("替换单行万能头并保留其余代码", () => {
    const before = "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n";
    const after = replaceUniversalHeader(before);
    assert.strictEqual(
      after,
      "#include <iostream>\n#include <algorithm>\n#include <cstring>\nusing namespace std;\n\nint main() {\n    return 0;\n}\n"
    );
    assert.strictEqual(after.includes("bits/stdc++.h"), false);
  });

  check("带缩进、CRLF 与行尾注释的万能头也能替换", () => {
    const after = replaceUniversalHeader("\t#include <bits/stdc++.h>  \r\nint main() {}\r\n");
    assert.strictEqual(
      after,
      "#include <iostream>\n#include <algorithm>\n#include <cstring>\nint main() {}\r\n"
    );
  });

  check("没有万能头时返回 null，不误改普通头", () => {
    assert.strictEqual(replaceUniversalHeader("#include <iostream>\n"), null);
    assert.strictEqual(replaceUniversalHeader("// #include <bits/stdc++.h>\n"), null);
    assert.strictEqual(replaceUniversalHeader(""), null);
    assert.strictEqual(replaceUniversalHeader(null), null);
  });

  console.log(`language-templates OK（${passed} 项）`);
}

main();
