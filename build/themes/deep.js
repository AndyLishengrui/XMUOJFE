/**
 * 主题：deep（② 深靛 —— 沉浸暗色，参考 deepseek.com）
 *
 * 用法：THEME=deep npm run build
 *
 * ⚠️ 暗色主题比亮色麻烦：iView 组件默认假定**浅底**（卡片白、文字黑、边框浅灰），
 * 所以下面**大量 iView 变量必须一起覆盖**，否则会出现"暗底上飘着白卡片"。
 * 特别注意这几个：
 *   @body-background / @background-color-base  —— 不改就是白底
 *   @title-color / @text-color / @subsidiary-color —— 不改就是黑字（暗底上看不见）
 *   @table-thead-bg / @table-td-stripe-bg / @table-td-hover-bg —— 表格底
 *   @border-color-base / @border-color-split —— 不改就是浅灰线
 *
 * ⚠️ 深色下边框不要用实色浅灰，用**半透明白**（hsla(0,0%,100%,.08)）——
 * 这样在任何层级的深底上都自然（这是参考站的做法）。
 */
module.exports = {
  // ══════════════════════════════════════════════════════
  //  iView 官方变量
  // ══════════════════════════════════════════════════════
  '@primary-color': '#4d6bfe',
  '@info-color': '#4d6bfe',
  '@success-color': '#3ecf8e',
  '@warning-color': '#f0b429',
  '@error-color': '#f2555a',
  '@link-color': '#6b85ff',
  '@rate-star-color': '#f0b429',

  '@body-background': '#15171c',
  '@title-color': '#e6e9ef',
  '@text-color': '#9aa4b8',
  '@subsidiary-color': '#6b7280',

  '@border-color-base': 'hsla(0,0%,100%,.16)',
  '@border-color-split': 'hsla(0,0%,100%,.08)',

  '@background-color-base': '#23272f',
  '@head-bg': '#1d2027',
  '@table-thead-bg': '#1d2027',
  '@table-td-stripe-bg': '#1a1e25',
  '@table-td-hover-bg': '#252932',
  '@table-td-highlight-bg': '#252932',

  '@menu-dark-title': '#1d2027',
  '@menu-dark-active-bg': '#15171c',

  // ══════════════════════════════════════════════════════
  //  本项目 token
  // ══════════════════════════════════════════════════════
  '@c-brand': '#4d6bfe',
  '@c-brand-hover': '#6b85ff',
  '@c-brand-tint': 'rgba(77,107,254,.16)',

  '@c-text-1': '#e6e9ef',
  '@c-text-2': '#9aa4b8',
  '@c-text-3': '#6b7280',
  '@c-text-inverse': '#ffffff',

  '@c-bg-page': '#15171c',
  '@c-bg-card': '#1d2027',
  '@c-bg-soft': '#23272f',
  '@c-bg-hover': '#252932',

  '@c-border': 'hsla(0,0%,100%,.08)',
  '@c-border-strong': 'hsla(0,0%,100%,.16)',

  '@c-success': '#3ecf8e',
  '@c-warning': '#f0b429',
  '@c-error': '#f2555a',
  '@c-info': '#4d6bfe',

  // 提交结果的独立状态色（ECharts 饼图）——深底上要提亮，否则发闷
  '@c-st-mle': '#e8c547',
  '@c-st-re': '#ff8a5c',
  '@c-st-ce': '#ffb066',

  // 语义色的极浅底 —— 🔑 暗色主题最关键的一处：
  // 这三条不改，状态徽章就会是"暗底上的亮绿/亮红块"，非常刺眼。
  '@c-success-tint': 'rgba(62,207,142,.14)',
  '@c-warning-tint': 'rgba(240,180,41,.14)',
  '@c-error-tint': 'rgba(242,85,90,.14)',

  '@c-code-bg': '#12141a',
  '@c-code-text': '#c9d3e0',

  '@app-page-bg': '#15171c',
  '@app-card-bg': '#1d2027'
}
