# XMUOJ VS Code 插件

在 VS Code 中完成 XMUOJ 的找题、读题、写代码、本地测试和提交。

## 亮点

- 侧边栏按“设置 / 公共题库 / 实验题库”组织，常用操作集中可见
- 一键打开代码、切换代码语言、运行本地测试、提交评测、查看结果报表
- 题面、代码、结果支持 side mode 分栏打开，减少来回切换
- 自动创建本地题目工作区，保存 `.xmuoj.json` 元数据和多语言源码
- 结果报表按题目聚合展示本地测试和在线评测，不混入其他题

## 主要功能

- 登录 XMUOJ，浏览实验题库和公共题库
- 打开题目后创建或恢复本地代码文件
- 下载公开测试数据，生成本地任务
- 支持 C、C++、Java、Python3 本地测试
- 提交当前文件并轮询判题结果
- 保存最近提交历史，并支持查看、筛选、清理
- 重新打开 VS Code 后恢复最近的题面、代码和结果报表布局

## 常用命令

- `XMUOJ：快速开始`
- `XMUOJ：登录`
- `XMUOJ：浏览实验题库`
- `XMUOJ：浏览题库`
- `XMUOJ：打开代码`
- `XMUOJ：切换代码语言`
- `XMUOJ：运行本地测试`
- `XMUOJ：提交当前文件`
- `XMUOJ：打开当前题结果报表`
- `XMUOJ：管理最近提交历史`
- `XMUOJ：选择本地工作目录`

## 常用配置

- `xmuoj.localWorkspaceRoot`：本地工作区根目录
- `xmuoj.editor.shortcuts`：编辑器顶部快捷入口
- `xmuoj.enableSideMode`：是否启用分栏布局
- `xmuoj.colorizeProblems`：是否显示状态颜色和图标

## 使用流程

1. 执行 `XMUOJ：快速开始` 并选择本地工作区目录
2. 登录后，通过“浏览实验题库”或“浏览题库”打开题目
3. 点击 `打开代码` 创建或恢复本地工作区
4. 需要换语言时点击 `切换代码语言`
5. 写完后运行 `本地测试`
6. 通过后执行 `提交当前文件`
7. 在 `结果报表` 中查看本地和在线结果

## 本地工作区结构

- 实验题库：`{localWorkspaceRoot}/contest-{id}/{problemId}-{title}/`
- 公共题库：`{localWorkspaceRoot}/problemsets/{problemId}-{title}/`

每个题目目录包含：
- `problem.md`：题目描述
- `.xmuoj.json`：题目元数据
- 多语言源码文件（如 `main.cpp`、`Main.java`、`main.py` 等）
- `samples/`：样例输入输出
- `testcases/`：测试数据（下载后）

## 安装

最新安装包：

- `xmuoj-vscode-0.0.77.vsix`
- 路径：`/Users/andyshengruilee/Downloads/OpenJudgeFE/xmuoj-vscode/xmuoj-vscode-0.0.77.vsix`

命令行安装：

```bash
code --install-extension /Users/andyshengruilee/Downloads/OpenJudgeFE/xmuoj-vscode/xmuoj-vscode-0.0.77.vsix
```

## 补充说明

- 插件已内置对自签名证书的支持，无需额外配置
- 如果提示 `/api/plugin/` 返回 `404`，说明站点后端尚未部署插件接口
- 如果题目绑定失效，提交前会提示重新绑定当前题目
- 插件会自动迁移旧的工作区配置到新的本地工作区根目录
