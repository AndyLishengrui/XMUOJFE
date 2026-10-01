/**
 * 主题：sand（③ 暖砂 —— 文学艺术风，纸质感）
 *
 * 用法：THEME=sand npm run build
 *
 * 与晴空同为亮色，但**色温完全相反**：晴空是冷白+天蓝，暖砂是暖白（像纸）+陶土橙。
 * 暖底比冷白护眼，适合长时间读题面 —— 这是三套主题里"换温度"的那一套。
 *
 * ⚠️ 暖色主题最容易翻车的地方是**灰色不能是纯灰**：
 * 纯灰摆在暖白底上会发"脏"。这里的文字灰都带一点暖调（#6b6259 而不是 #666）。
 */
module.exports = {
  // ══════════════════════════════════════════════════════
  //  iView 官方变量
  // ══════════════════════════════════════════════════════
  '@primary-color': '#c2410c',
  '@info-color': '#0e7490',
  '@success-color': '#15803d',
  '@warning-color': '#b45309',
  '@error-color': '#b91c1c',
  '@link-color': '#c2410c',
  '@rate-star-color': '#d97706',

  '@body-background': '#ffffff',
  '@title-color': '#2b2622',
  '@text-color': '#6b6259',
  '@subsidiary-color': '#9c9188',

  '@border-color-base': 'rgba(43,38,34,.22)',
  '@border-color-split': 'rgba(43,38,34,.12)',

  '@background-color-base': '#f5f0e8',
  '@head-bg': '#f5f0e8',
  '@table-thead-bg': '#f5f0e8',
  '@table-td-stripe-bg': '#faf8f4',
  '@table-td-hover-bg': '#f2ece2',
  '@table-td-highlight-bg': '#f2ece2',

  '@menu-dark-title': '#3a332c',
  '@menu-dark-active-bg': '#2b2622',

  // ══════════════════════════════════════════════════════
  //  本项目 token
  // ══════════════════════════════════════════════════════
  '@c-brand': '#c2410c',
  '@c-brand-hover': '#a83a0a',
  '@c-brand-tint': '#fdf0e9',

  '@c-text-1': '#2b2622',
  '@c-text-2': '#6b6259',
  '@c-text-3': '#9c9188',
  '@c-text-inverse': '#ffffff',

  '@c-bg-page': '#faf8f4',
  '@c-bg-card': '#ffffff',
  '@c-bg-soft': '#f5f0e8',
  '@c-bg-hover': '#f2ece2',

  '@c-border': 'rgba(43,38,34,.12)',
  '@c-border-strong': 'rgba(43,38,34,.22)',

  '@c-success': '#15803d',
  '@c-warning': '#b45309',
  '@c-error': '#b91c1c',
  '@c-info': '#0e7490',

  // 提交结果的独立状态色（ECharts 饼图）——暖底上要避开刺眼的纯色
  '@c-st-mle': '#ca8a04',
  '@c-st-re': '#dc5f2a',
  '@c-st-ce': '#d97706',

  '@c-success-tint': '#eaf5ec',
  '@c-warning-tint': '#fbf1e3',
  '@c-error-tint': '#fbeaea',

  '@c-code-bg': '#f5f1ea',
  '@c-code-text': '#4a4038',

  '@app-page-bg': '#faf8f4',
  '@app-card-bg': '#ffffff',

  // 表头
  '@c-bg-thead': '#f5f0e8',
  '@c-text-thead': '#6b6259',

  // 明暗标记 —— 只给 JS 读；暖砂是亮色主题
  '@c-scheme': '~"light"',

  // 代码高亮 —— 底色/正文换成暖色（跟 --c-code-bg 同族），
  // 语法色沿用 atom-one-light（这几档在暖底上同样能看清，不另造一套）。
  '@c-hl-bg': '#f7f2ea',
  '@c-hl-fg': '#423a33',
  '@c-hl-comment': '#9c9188',
  '@c-hl-keyword': '#a626a4',
  '@c-hl-name': '#c4432f',
  '@c-hl-literal': '#0184bb',
  '@c-hl-string': '#4a7c3f',
  '@c-hl-builtin': '#b5761a',
  '@c-hl-attr': '#986801',
  '@c-hl-symbol': '#3f6fd0',

  // 代码块的行号列（暖底上把灰调偏暖）
  '@c-ln-fg': '#8a8078',
  '@c-ln-border': '#c9c0b4'
}
