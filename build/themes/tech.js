/**
 * 主题：tech（科技风暗色）—— 🚧 初稿，配色待与老师确认后细化
 *
 * 这份是**深色底 + 青蓝荧光主色**的科技风。变量名与 light.js 一致，
 * 只改值不改名 —— 这样才能保证三个主题可互换。
 *
 * 用法：THEME=tech npm run build
 */
module.exports = {
  // ── 品牌色（青蓝荧光）──────────────────────────────────
  '@primary-color': '#00d4ff',
  '@info-color': '#00d4ff',
  '@success-color': '#00ff9d',
  '@warning-color': '#ffb020',
  '@error-color': '#ff4d6a',
  '@link-color': '#00d4ff',
  '@rate-star-color': '#ffc53d',

  // ── 正文与标题（深底浅字）──────────────────────────────
  '@body-background': '#0d1117',
  '@title-color': '#e6edf3',
  '@text-color': '#c9d1d9',
  '@subsidiary-color': '#8b949e',

  // ── 边框（深色下要提亮一点才看得见）────────────────────
  '@border-color-base': '#30363d',
  '@border-color-split': '#21262d',

  // ── 背景 ────────────────────────────────────────────────
  '@background-color-base': '#161b22',
  '@head-bg': '#161b22',
  '@table-thead-bg': '#161b22',
  '@table-td-stripe-bg': '#0f141b',
  '@table-td-hover-bg': '#1c2733',
  '@table-td-highlight-bg': '#1c2733',

  // ── 侧边/深色菜单 ───────────────────────────────────────
  '@menu-dark-title': '#161b22',
  '@menu-dark-active-bg': '#0d1117',

  // ── 布局 ────────────────────────────────────────────────
  '@app-page-bg': '#0d1117',
  '@app-card-bg': '#161b22'
}
