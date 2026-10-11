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

/**
 * 把「用户选的配色名」解析成实际要加载的那一套（'light' | 'deep' | 'sand'）。
 *   'light'/'deep'/'sand' 原样返回；'auto' 按**访问者本地时间**选。
 *
 * ⚠️ auto 的分档规则必须与 index.html 里那段内联脚本**逐字一致**：
 *    00:00-06:59 深靛 / 07:00-18:59 晴空 / 19:00-23:59 暖砂。
 *    两边一旦不一致，就会出现「切到 auto 后的配色 ≠ 刷新后的配色」。
 * 返回 null = 解析不出来（映射表里没这套），调用方应放弃本次切换。
 */
export function resolveTheme (name) {
  const css = (typeof window !== 'undefined' && window.__OJ_THEME__ && window.__OJ_THEME__.css) || {}
  let t = name
  if (t === 'auto') {
    const h = new Date().getHours()
    t = h < 7 ? 'deep' : (h < 19 ? 'light' : 'sand')
  }
  return css[t] ? t : null
}

/**
 * **不刷新页面**换配色。
 *
 * 为什么必须不刷新：原来 changeTheme 里是 window.location.reload()，
 * 而「把代码存进 localStorage」的钩子是路由的 beforeRouteLeave ——
 * **整页刷新不会触发它** ⇒ 学生在题目页写了没保存的代码，一点配色就被清空了（真实事故）。
 *
 * 做法：找到 index.html 里那段内联脚本 document.write 出来的主题 <link>，换掉它的 href。
 *   新表**先加载、加载完再摘掉旧表**，且插在旧表**原来的位置**（不挪到 head 末尾）
 *   ⇒ 中间既不闪白，层叠顺序也与刷新后一致。
 *   整套界面都写在 var(--c-*) 上，所以换掉文件 = 所有颜色立刻跟着变。
 *
 * 唯一读不到 CSS 变量的运行期组件是 Monaco 编辑器（它的主题是 JS 参数，不是 CSS），
 * 所以这里额外派发一个 window 事件 'oj-theme-change'，由编辑器那边自己跟。
 *
 * @returns {boolean} 是否成功切换
 */
export function applyTheme (name) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  const target = resolveTheme(name)
  if (!target) return false

  const info = window.__OJ_THEME__ || {}
  const href = (info.css || {})[target]
  const old = document.querySelector('link[rel="stylesheet"][href*="/static/css/oj."]')

  const finish = () => {
    if (old && old.parentNode) old.parentNode.removeChild(old)
    document.documentElement.setAttribute('data-theme', target)
    // 回写状态。下次刷新时那段内联脚本读的是 localStorage，这里只是让本页读法保持一致。
    info.pick = name
    info.resolved = target
    info.scheme = siteScheme()
    window.__OJ_THEME__ = info
    window.dispatchEvent(new CustomEvent('oj-theme-change', {
      detail: {theme: target, scheme: info.scheme}
    }))
  }

  // 当前就是这套 → 不折腾 <link>，只同步一下状态
  if (old && old.getAttribute('href') === href) {
    finish()
    return true
  }

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  let settled = false
  const once = () => { if (!settled) { settled = true; finish() } }
  link.onload = once
  // 加载失败也别卡住：旧表还在，界面不会坏，只是这次切换没生效
  link.onerror = once
  if (old && old.parentNode) {
    old.parentNode.insertBefore(link, old.nextSibling)
  } else {
    document.head.appendChild(link)
  }
  // 个别环境下 onload 可能不触发，兜个底
  setTimeout(once, 1500)
  return true
}
