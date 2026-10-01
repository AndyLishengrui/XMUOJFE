/**
 * 主题：light（亮色，= 本站现状）
 *
 * ⚠️ 这里是**默认/基线主题**，所有值都等于 iView 官方默认值。
 * 改这个文件等于改"现在的样子"，所以除了修 bug，不要动它 ——
 * 新主题请复制成 tech.js / art.js 再改。
 *
 * 这些变量会通过 less-loader 的 modifyVars 注入到**每一次 LESS 编译**：
 *   · iView 自身的 LESS 源（node_modules/iview/src/styles/index.less）
 *   · 各 .vue 文件里的 <style lang="less">
 *   · 独立的 .less 文件
 * 所以只要在这里改色，整套 UI（含 iView 组件）会一起换。
 *
 * 变量名沿用 iView 的官方命名（见 node_modules/iview/src/styles/custom.less）。
 */
module.exports = {
  // ── 品牌色 ──────────────────────────────────────────────
  '@primary-color': '#2d8cf0',
  '@info-color': '#2db7f5',
  '@success-color': '#19be6b',
  '@warning-color': '#ff9900',
  '@error-color': '#ed3f14',
  '@link-color': '#2d8cf0',
  '@rate-star-color': '#f5a623',

  // ── 正文与标题 ──────────────────────────────────────────
  '@body-background': '#fff',
  '@title-color': '#1c2438',
  '@text-color': '#495060',
  '@subsidiary-color': '#80848f',

  // ── 边框 ────────────────────────────────────────────────
  '@border-color-base': '#dddee1', // 外边框
  '@border-color-split': '#e9eaec', // 内部分割线

  // ── 背景 ────────────────────────────────────────────────
  '@background-color-base': '#f7f7f7',
  '@head-bg': '#f9fafc',
  '@table-thead-bg': '#f8f8f9',
  '@table-td-stripe-bg': '#f8f8f9',
  '@table-td-hover-bg': '#ebf7ff',
  '@table-td-highlight-bg': '#ebf7ff',

  // ── 侧边/深色菜单 ───────────────────────────────────────
  '@menu-dark-title': '#495060',
  '@menu-dark-active-bg': '#363e4f',

  // ── 布局（应用自身在用，见 styles/common.less）────────────
  '@app-page-bg': '#eee',
  '@app-card-bg': '#fff'
}
