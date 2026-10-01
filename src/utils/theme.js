/**
 * 主题工具 —— 让 JS 知道"现在是哪套皮"。
 *
 * 🔑 为什么要这么绕一层：JS 驱动的组件（Monaco 编辑器、ECharts、KaTeX…）
 *    **读不到 LESS 变量**，它们的主题是运行期参数。换主题是靠加载另一份 CSS
 *    实现的，JS 本身不变 —— 所以 JS 必须**在运行期问一次 CSS**。
 *
 * 做法：主题文件里定义了 `@c-scheme`（'light' / 'dark'），经 index.less
 * 输出成 `:root { --c-scheme: ... }`。这里用 getComputedStyle 读出来。
 *
 * ⚠️ 两个坑：
 *   1. `--c-scheme` 的值是 LESS 用 `~""` 转义输出的，**不带引号**；
 *      但不同浏览器/序列化方式偶尔会带引号，所以这里统一 strip 一下。
 *   2. 必须在**样式表已加载后**调用。组件在 created/mounted 时样式早已就绪；
 *      若要更早（比如 main.js 顶部），读不到会退回 'light' —— 这是安全默认值
 *      （线上生产环境本来就只有 light）。
 */

const FALLBACK = 'light'

/**
 * 读当前主题的明暗标记。
 * @returns {'light'|'dark'}
 */
export function siteScheme () {
  try {
    const raw = window.getComputedStyle(document.documentElement)
      .getPropertyValue('--c-scheme')
    // 去掉可能的引号和空白
    const value = raw.replace(/["'\s]/g, '')
    return value === 'dark' ? 'dark' : FALLBACK
  } catch (e) {
    return FALLBACK
  }
}

/**
 * 当前站点是不是暗色主题。
 * @returns {boolean}
 */
export function isDarkSite () {
  return siteScheme() === 'dark'
}

/**
 * Monaco 编辑器的默认主题。
 *
 * 站点是暗色 → 'vs-dark'，否则 'vs'（Monaco 自带的亮色）。
 * ⚠️ 只作为**默认值**：用户自己在编辑器右上角选过主题的话，那份偏好优先。
 */
export function defaultEditorTheme () {
  return isDarkSite() ? 'vs-dark' : 'vs'
}
