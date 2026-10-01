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
  '@primary-color': '#2d8cf0',
  '@info-color': '#2db7f5',
  '@success-color': '#19be6b',
  '@warning-color': '#ff9900',
  '@error-color': '#ed3f14',
  '@link-color': '#2d8cf0',
  '@rate-star-color': '#f5a623',

  '@body-background': '#fff',
  '@title-color': '#1c2438',
  '@text-color': '#495060',
  '@subsidiary-color': '#80848f',

  '@border-color-base': '#dddee1',
  '@border-color-split': '#e9eaec',

  '@background-color-base': '#f7f7f7',
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
  '@c-brand': '#2d8cf0',
  '@c-brand-hover': '#2b85e4',
  '@c-brand-tint': '#eef6ff',

  // 文字三级
  '@c-text-1': '#1c2438',
  '@c-text-2': '#495060',
  '@c-text-3': '#80848f',
  '@c-text-inverse': '#ffffff',

  // 背景
  '@c-bg-page': '#eee',
  '@c-bg-card': '#ffffff',
  '@c-bg-soft': '#f8f8f9',
  '@c-bg-hover': '#f3f5f7',

  // 边框
  '@c-border': '#e8eaec',
  '@c-border-strong': '#dddee1',

  // 语义
  '@c-success': '#19be6b',
  '@c-warning': '#ff9900',
  '@c-error': '#ff4949',
  '@c-info': '#2db7f5',

  // 提交结果里的独立状态色（ECharts 饼图用）——不能和 WA 撞色，所以单独给 token
  '@c-st-mle': '#f7de00',
  '@c-st-re': '#ff6104',
  '@c-st-ce': '#ff9300',

  // 语义色的「极浅底」——状态徽章/提示条的背景。
  // 🔑 这几个在暗色主题里必须换成暗色调，否则就是最典型的"露白底"。
  '@c-success-tint': '#edfff3',
  '@c-warning-tint': '#fff7e6',
  '@c-error-tint': '#ffeef0',

  // 代码
  '@c-code-bg': '#f6f8fa',
  '@c-code-text': '#476573',

  // 布局（应用自身在用，见 styles/common.less）
  '@app-page-bg': '#eee',
  '@app-card-bg': '#fff'
}
