/**
 * 主题选择器。
 *
 * 用环境变量 THEME 选择主题，默认 light：
 *   THEME=light npm run build     # 亮色（本站现状）
 *   THEME=tech  npm run build     # 科技风暗色
 *   THEME=art   npm run build     # 艺术风橙色
 *
 * 目前只用于「站点级换主题」方案：构建期决定配色。
 * 后续若要改成运行期切换，可以把三套 CSS 都部署、由 index.html 挑一份加载。
 */
const fs = require('fs')
const path = require('path')

const THEME = process.env.THEME || 'light'
const file = path.join(__dirname, THEME + '.js')

if (!fs.existsSync(file)) {
  // 不静默回退 —— 写错主题名却编出默认配色，比直接报错更难发现
  throw new Error(
    `[theme] 找不到主题 "${THEME}"（期望 ${file}）。` +
    `可用：${fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== 'index.js').map(f => f.replace('.js', '')).join(', ')}`
  )
}

const vars = require(file)
console.log(`[theme] 使用主题：${THEME}（${Object.keys(vars).length} 个变量）`)

module.exports = { THEME, vars }
