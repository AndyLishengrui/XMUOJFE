/**
 * 新建本地源码时使用的语言模板。
 *
 * C++ 不使用 <bits/stdc++.h>：libstdc++ 的万能头在 macOS/Xcode 的
 * libc++ 环境下不可用。这里只列出最常用的三个标准头，保证模板开箱即编译。
 */
"use strict";

const CPP_HEADERS = ["#include <iostream>", "#include <algorithm>", "#include <cstring>"];

const LOCAL_LANGUAGE_TEMPLATES = {
  C: "#include <stdio.h>\n\nint main(void) {\n    return 0;\n}\n",
  "C++": `${CPP_HEADERS.join("\n")}\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n`,
  Java: "import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n    }\n}\n",
  Python3: "def main():\n    pass\n\n\nif __name__ == '__main__':\n    main()\n"
};

/** 把一段文本里单独成行的万能头替换成三个标准头。返回 null 表示无需替换。 */
function replaceUniversalHeader(text) {
  const source = typeof text === "string" ? text : "";
  const pattern = /^[ \t]*#include[ \t]*<bits\/stdc\+\+\.h>[ \t]*(?:\r?\n|$)/gm;
  if (!pattern.test(source)) {
    return null;
  }
  return source.replace(pattern, `${CPP_HEADERS.join("\n")}\n`);
}

module.exports = {
  CPP_HEADERS,
  LOCAL_LANGUAGE_TEMPLATES,
  replaceUniversalHeader
};
