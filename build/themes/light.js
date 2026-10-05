/**
 * 主题：light（亮色）
 *
 * ⚠️ 当前是**等价抽取阶段**：所有值都等于站点现在实际在用的颜色
 * （iView 官方默认 + 应用自身硬编码色），目的是先把颜色抽成 token 而不改变外观。
 * 抽取验证通过后，再单独一步把主色升级成「晴空」(#0095ff)。
 *
 * 这些变量通过 less-loader 的 modifyVars 注入到**每一次 LESS 编译**：
 *   · iView 自身的 LESS 源（node_modules/iview/src/styles/index.less）
 *   · 各 .vue 文件里的 <style lang="less">
 *   · 独立的 .less 文件
 * 前半段是 iView 的官方变量名（见 node_modules/iview/src/styles/custom.less），
 * 后半段（@c-*）是本项目自己的 token，会在 src/styles/index.less 里输出成
 * CSS 自定义属性 `:root { --c-*: ... }`，供 JS / 内联样式 / ECharts 使用。
 */
module.exports = {
  // ══════════════════════════════════════════════════════
  //  第一部分：iView 官方变量（控制 iView 组件的外观）
  // ══════════════════════════════════════════════════════
  '@primary-color': '#0095ff',
  '@info-color': '#0891b2',
  '@success-color': '#16a34a',
  '@warning-color': '#d97706',
  '@error-color': '#dc2626',
  '@link-color': '#0095ff',
  '@rate-star-color': '#f5a623',

  '@body-background': '#fff',
  '@title-color': '#1a2233',
  '@text-color': '#5a6b82',
  '@subsidiary-color': '#94a3b8',

  '@border-color-base': 'rgba(15,23,42,.18)',
  '@border-color-split': 'rgba(15,23,42,.10)',

  '@background-color-base': '#f0f4f8',
  '@head-bg': '#f9fafc',
  '@table-thead-bg': '#f8f8f9',
  '@table-td-stripe-bg': '#f8f8f9',
  '@table-td-hover-bg': '#ebf7ff',
  '@table-td-highlight-bg': '#ebf7ff',

  '@menu-dark-title': '#495060',
  '@menu-dark-active-bg': '#363e4f',

  // ══════════════════════════════════════════════════════
  //  第二部分：本项目自己的 token（@c-*）
  //  会被输出成 :root 里的 CSS 自定义属性，供 JS 也能读到。
  //  值 = 站点现在实际在用的颜色（等价抽取，不改外观）。
  // ══════════════════════════════════════════════════════

  // 品牌
  '@c-brand': '#0095ff',
  '@c-brand-hover': '#0080e6',
  '@c-brand-tint': '#e6f4ff',

  // 文字三级
  '@c-text-1': '#1a2233',
  '@c-text-2': '#5a6b82',
  '@c-text-3': '#94a3b8',
  '@c-text-inverse': '#ffffff',

  // 背景
  '@c-bg-page': '#f7f9fb',
  '@c-bg-card': '#ffffff',
  '@c-bg-soft': '#f0f4f8',
  '@c-bg-hover': '#eef3f8',

  // 边框
  '@c-border': 'rgba(15,23,42,.10)',
  '@c-border-strong': 'rgba(15,23,42,.18)',

  // 语义
  '@c-success': '#16a34a',
  '@c-warning': '#d97706',
  '@c-error': '#dc2626',
  '@c-info': '#0891b2',
  '@c-gold': '#b8860b',

  // 提交结果里的独立状态色（ECharts 饼图用）——不能和 WA 撞色，所以单独给 token
  '@c-st-mle': '#f7de00',
  '@c-st-re': '#ff6104',
  '@c-st-ce': '#ff9300',

  // 语义色的「极浅底」——状态徽章/提示条的背景。
  // 🔑 这几个在暗色主题里必须换成暗色调，否则就是最典型的"露白底"。
  '@c-success-tint': '#e9f9ef',
  '@c-warning-tint': '#fdf3e3',
  '@c-error-tint': '#fdecec',

  // 代码
  '@c-code-bg': '#f6f8fa',
  '@c-code-text': '#476573',

  // 布局（应用自身在用，见 styles/common.less）
  '@app-page-bg': '#f7f9fb',
  '@app-card-bg': '#fff',

  // 表头 —— 对应 iView 的 @table-thead-bg / 表头文字色。
  // 🔑 为什么单列 token：iView 表头底色走的是 `@table-thead-bg`（≠ --c-bg-card）。
  //   我先前误把 .ivu-table th 接进 --c-bg-card 那一组，结果亮色下表头从 #f8f8f9 变成纯白。
  '@c-bg-thead': '#f8f8f9',
  '@c-text-thead': '#5a6b82',

  // 明暗标记 —— 只给 JS 读（Monaco / 代码高亮 / 以后的 ECharts）。
  // CSS 侧没有任何规则引用它，所以不会影响任何现有外观。
  // ⚠️ 必须用 ~"" 转义，否则 LESS 会输出带引号的字符串。
  '@c-scheme': '~"light"',

  // 代码高亮（highlight.js）—— 取值即 highlight.js 的 atom-one-light
  '@c-hl-bg': '#fafafa',
  '@c-hl-fg': '#383a42',
  '@c-hl-comment': '#a0a1a7',
  '@c-hl-keyword': '#a626a4',
  '@c-hl-name': '#e45649',
  '@c-hl-literal': '#0184bb',
  '@c-hl-string': '#50a14f',
  '@c-hl-builtin': '#c18401',
  '@c-hl-attr': '#986801',
  '@c-hl-symbol': '#4078f2',

  // 代码块的行号列（见 src/plugins/linenumbers.css）
  // 那份 CSS 原来写死 color:#666 / border-right:1px solid #999 —— 见下方 deep 的注释。
  // 亮色下取值与原来**逐字相同**，外观零变化。
  '@c-ln-fg': '#666',
  '@c-ln-border': '#999'
}
