# XMUOJ VS Code 插件发布流程

## 一、发布前检查清单

- [ ] 在 `package.json` 中更新 `version` 字段（如 `"0.0.90"` → `"0.0.91"`）
- [ ] 更新 `README.md` 中提及版本号的安装说明
- [ ] 确认 `.vscodeignore` 包含以下排除规则（防止打包体积异常膨胀）：

```
*.zip
xmuoj-vscode-*.vsix
xmuoj/**
.git/**
temp-old-vsix/**
```

---

## 二、打包命令

```bash
cd /Users/andyshengruilee/Downloads/OpenJudgeFE/xmuoj-vscode
npm run package
```

打包成功后会在当前目录生成 `xmuoj-vscode-{version}.vsix`。

**正常体积参考：约 99 KB，约 38 个文件。**

> ⚠️ 如果 VSIX 体积异常大（>500 KB），说明有文件被意外打包进去。
> 最常见原因：`.vscodeignore` 缺少 `*.zip`，导致 `release-assets.zip` 等文件被打入包内。

---

## 三、发布到 GitHub Release

**Release 仓库地址（注意：与源码 remote 不同）：**
- Release 仓库：`https://github.com/AndyLishengrui/xmuoj`
- 源码 remote：`https://github.com/AndyLishengrui/XMUOJFE.git`（不要搞混）

### 操作步骤（浏览器操作）

1. 打开：`https://github.com/AndyLishengrui/xmuoj/releases/new`
2. **Tag**：输入 `v{version}`，例如 `v0.0.91`，选择 "Create new tag on publish"
3. **Release title**：填写 `XMUOJ VS Code 插件 {version}`，例如 `XMUOJ VS Code 插件 0.0.91`
4. **描述**：用中文写更新说明，列出本次修改内容
5. **上传附件**：
   - ✅ 上传 `xmuoj-vscode-{version}.vsix`
   - ✅ 上传 `README.md`（可选）
   - ❌ **不要上传任何 `.zip` 文件**
6. 点击 **"Publish release"**

### 更新已有 Release（修复 bug 后重新上传）

1. 打开已发布的 Release 页面
2. 点击右上角铅笔图标 **"Edit"**
3. 在 Assets 区域删除旧的 `.vsix` 文件
4. 重新上传新的 `.vsix`
5. 更新描述（注明"已修复…"）
6. 点击 **"Update release"**

---

## 四、常见陷阱与历史教训

### 陷阱 1：比赛状态常量映射反了

**后端 `OnlineJudge/utils/constants.py`**：
```python
CONTEST_NOT_START = "1"   # 尚未开始
CONTEST_ENDED     = "-1"  # 已结束
CONTEST_UNDERWAY  = "0"   # 进行中
```

**插件中 `normalizeContestStatus(status)` 必须对应**（`extension.js` 和 `treeData.js` 各一份）：
```javascript
function normalizeContestStatus(status) {
  if (status === "-1") return { key: "ended",   label: "已结束" };
  if (status === "0")  return { key: "running",  label: "进行中" };
  if (status === "1")  return { key: "pending",  label: "未开始" };
  return { key: "unknown", label: "未知" };
}
```

> 历史 bug：曾经把 `"0"` 和 `"1"` 对应的 key 写反，导致进行中的比赛显示为"未开始"。

### 陷阱 2：release-assets.zip 被打入 VSIX

`.vscodeignore` 没有 `*.zip` 时，自动生成的 zip 文件会被打包进去，VSIX 体积从 ~99 KB 暴涨到 ~500 KB+。

**修复**：在 `.vscodeignore` 中加入 `*.zip`，重新执行 `npm run package`。

### 陷阱 3：搞混两个 GitHub 仓库

| 用途 | 仓库 |
|------|------|
| 插件源码 | `https://github.com/AndyLishengrui/XMUOJFE.git` |
| GitHub Release 发布 | `https://github.com/AndyLishengrui/xmuoj` |

Release 只发布到 `xmuoj` 仓库，不要 push VSIX 到 `XMUOJFE`。

---

## 五、快速参考

```bash
# 打包
cd xmuoj-vscode
npm run package

# 验证体积（应约 99 KB）
ls -lh xmuoj-vscode-*.vsix

# 验证文件数（应约 38 个）
unzip -l xmuoj-vscode-*.vsix | tail -1
```

发布地址：`https://github.com/AndyLishengrui/xmuoj/releases/new`
