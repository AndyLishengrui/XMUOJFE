# 主题 token 定义与硬编码色映射表

> 第 2 步的作业单。目标：把 `src/` 里 **122 个不同色值 / 376 次出现** 收敛到下面这套 token。

## 🔑 技术选型：用 **CSS 自定义属性**，不用 LESS 变量

原因：**颜色不只在 `<style>` 里，JS 里也有** ——
- `pages/oj/components/mixins/problem.js`：内联样式 `color: status === 0 ? '#19be6b' : '#ed3f14'`
- `pages/oj/views/problem/chartData.js`：**ECharts 饼图的 7 个配色**

LESS 变量在编译期就没了，到不了 JS；CSS 变量可以（`var(--c-x)`）。
ECharts 那种画到 canvas 的，运行时用 `getComputedStyle(document.documentElement).getPropertyValue('--c-x')` 读。

**生成方式**：`build/themes/*.js` 里加 token → 经 modifyVars 注入 → `src/styles/index.less` 里输出一个 `:root{ --c-x: @c-x; }` 块。

## Token 集（28 个）

### 品牌
| token | light(晴空) | 说明 |
|---|---|---|
| `--c-brand` | `#0095ff` | 主色（原 `#2d8cf0`） |
| `--c-brand-hover` | `#0080e6` | 悬停/按下 |
| `--c-brand-tint` | `#e6f4ff` | 极浅底（原 `#eef6ff`/`#e8f4ff`/`#eaeefb`） |
| `--c-brand-text` | `#0080e6` | 需要"文字用品牌色但不那么亮"时 |

### 文字（三级）
| token | light(晴空) | 映射自 |
|---|---|---|
| `--c-text-1` | `#1a2233` | `#1c2438` `#333` `#444` `#303133`(el) |
| `--c-text-2` | `#5a6b82` | `#495060` `#666` `#606266`(el) `#657180` |
| `--c-text-3` | `#94a3b8` | `#80848f` `#999` `#909399`(el) `#9ea7b4` |
| `--c-text-inverse` | `#ffffff` | `#fff` `#ffffff`（用在深底上） |

### 背景
| token | light(晴空) | 映射自 |
|---|---|---|
| `--c-bg-page` | `#f7f9fb` | `#eee` `#f7f7f7` |
| `--c-bg-card` | `#ffffff` | `#fff` `#ffffff` |
| `--c-bg-soft` | `#f0f4f8` | `#f8f8f9` `#f9fafc` `#fafafa` `#f0f0f0` `#fafbfc` |
| `--c-bg-hover` | `#eef3f8` | `#f3f5f7` `#ebf7ff` `#f7f9fc` |

### 边框
| token | light(晴空) | 映射自 |
|---|---|---|
| `--c-border` | `rgba(15,23,42,.10)` | `#e8eaec` `#e9eaec` `#e8e8e8` `#ebeef5` `#f0f0f0` `#e4e5e7` `#e3e8ee` |
| `--c-border-strong` | `rgba(15,23,42,.18)` | `#dddee1` `#ccc` `#dcdfe6` `#bbbec4` |

### 语义
| token | light(晴空) | 映射自 |
|---|---|---|
| `--c-success` | `#16a34a` | `#19be6b` `#13ce66` `#67c23a` |
| `--c-warning` | `#d97706` | `#ff9900` `#f90` |
| `--c-error` | `#dc2626` | `#ff4949` `#ed3f14` `#ed4014` `#f56c6c` |
| `--c-info` | `#0891b2` | `#2db7f5` |

### 代码
| token | light(晴空) | 映射自 |
|---|---|---|
| `--c-code-bg` | `#f6f8fa` | `#f6f8fa` `#f7f7f7` |
| `--c-code-text` | `#3d4d5c` | `#476573` `#414141` |

### 状态色（提交结果，**JS 里也要用**）
| token | light(晴空) |
|---|---|
| `--c-status-ac` | 同 `--c-success` |
| `--c-status-wa` | 同 `--c-error` |
| `--c-status-tle` | 同 `--c-warning` |
| `--c-status-ce` | 同 `--c-text-3` |

## ⚠️ 两套设计语言并存（重要）

本项目同时用 iView（学生端）和 element-ui（后台），两套各有自己的调色板。
**本表映射的是 iView 那一套（学生端）**。

后台用的 element-ui 调色板（`#409eff` `#67c23a` `#f56c6c` `#909399` `#606266` `#ebeef5` `#dcdfe6`）
**暂不动** —— element-ui 要换色得重编译它的 SCSS（项目没装 sass），另作一轮。

## ⚠️ 明度相近但不该合并的

替换时要**逐个判断角色**，不能按色值盲替：
- `#fff` 有 18 次，但有的是**卡片底**（→ `--c-bg-card`）、有的是**深底上的文字**（→ `--c-text-inverse`）
- `#f7f7f7` 有 5 次，既可能是**页面底**也可能是**代码块底**
- `#e8eaec` 既可能是**边框**也可能是**表格斑马纹**

⇒ **必须看上下文**，这也是第 2 步不能全自动的原因。
