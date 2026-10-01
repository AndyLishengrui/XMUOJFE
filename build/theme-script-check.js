/**
 * 主题脚本自检：`node build/theme-script-check.js`（构建之后跑）
 *
 * 把构建产物 dist/index.html 里**真实生成的那段主题脚本**抠出来，在各种条件下跑一遍。
 * 这段脚本一旦写错，表现是"整站没有样式"，而且日志里什么都看不到 —— 必须机器验证。
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const html = fs.readFileSync(path.resolve(__dirname, '../dist/index.html'), 'utf8')
const m = html.match(/<script>\(function\(\)\{var site=.*?\}\)\(\)<\/script>/)
if (!m) {
  console.error('❌ 在 dist/index.html 里没找到主题脚本')
  process.exit(1)
}
const code = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '')
console.log('取到脚本长度', code.length, '字符\n')

function run ({ site, pick, hour, search }) {
  // 站点档位是**构建时**写死在产物里的（THEME_MODE），测试里把它换成想验证的档
  const src = code.replace(/var site='[a-z]+'/, `var site='${site}'`)
  const written = []
  const el = { setAttribute () {} }
  const sandbox = {
    Date: class { getHours () { return hour } },
    localStorage: { getItem: k => (k === 'oj_theme' ? (pick || null) : null) },
    location: { search: search || '' },
    document: { write: s => written.push(s), documentElement: el },
    window: {}
  }
  // 脚本里用 window.__OJ_THEME__ 暴露状态
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  const link = written.join('')
  const href = (link.match(/href="([^"]+)"/) || [])[1] || null
  const name = href ? href.replace(/^\/static\/css\//, '').replace(/^oj\.|\.css$/g, '') : null
  const cssName = t => {
    const mm = src.match(new RegExp(t + ":'([^']+)'"))
    return mm ? mm[1] : null
  }
  let theme = '?'
  for (const t of ['light', 'deep', 'sand']) if (cssName(t) === href) theme = t
  return { theme, info: sandbox.__OJ_THEME__, wrote: written.length }
}

const cases = [
  // 说明, 参数, 期望
  ['站点 auto（默认时段 10 点）+ 没选过        → 晴空', { site: 'auto', hour: 10 }, 'light'],
  ['站点 auto（时段 22 点）+ 没选过            → 暖砂', { site: 'auto', hour: 22 }, 'sand'],
  ['站点 auto + 用户选过 deep                 → 深靛', { site: 'auto', pick: 'deep', hour: 10 }, 'deep'],
  ['站点 auto + 用户选过 sand                 → 暖砂', { site: 'auto', pick: 'sand', hour: 10 }, 'sand'],
  ['站点 auto + 用户选 auto（跟随站点）        → 晴空', { site: 'auto', pick: 'auto', hour: 10 }, 'light'],
  ['站点 auto + 用户选过 light（10 点也是晴空） → 晴空', { site: 'auto', pick: 'light', hour: 10 }, 'light'],
  ['站点 auto + 用户存了垃圾值 abc             → 回落到时段', { site: 'auto', pick: 'abc', hour: 22 }, 'sand'],
  ['?theme=deep 预览后门 压过用户选择          → 深靛', { site: 'auto', pick: 'light', hour: 10, search: '?theme=deep' }, 'deep'],
  ['?theme=sand 预览后门 压过站点固定          → 暖砂', { site: 'light', search: '?theme=sand' }, 'sand']
]

let fail = 0
for (const [label, args, expect] of cases) {
  const r = run(args)
  const ok = r.theme === expect
  if (!ok) fail++
  console.log(`${ok ? '✅' : '❌'} ${label}  → 实际 ${r.theme}（期望 ${expect}）`)
}

// 站点把外观钉死时，用户的选择必须无效
console.log('')
const locked1 = run({ site: 'light', pick: 'deep', hour: 22 })
console.log(`${locked1.theme === 'light' ? '✅' : '❌'} 站点钉死 light + 用户选过 deep → 实际 ${locked1.theme}（期望 light：站点优先）`)
if (locked1.theme !== 'light') fail++
const locked2 = run({ site: 'deep', hour: 10 })
console.log(`${locked2.theme === 'deep' ? '✅' : '❌'} 站点钉死 deep + 用户没选过 → 实际 ${locked2.theme}（期望 deep）`)
if (locked2.theme !== 'deep') fail++

// window.__OJ_THEME__（给导航栏用的）
console.log('')
const infoAuto = run({ site: 'auto', pick: 'deep', hour: 10 }).info
const infoLocked = run({ site: 'light', hour: 10 }).info
const okInfo = infoAuto && infoAuto.switchable === true && infoAuto.pick === 'deep' && infoAuto.resolved === 'deep' &&
               infoLocked && infoLocked.switchable === false
console.log(`${okInfo ? '✅' : '❌'} window.__OJ_THEME__ = ${JSON.stringify(infoAuto)}`, '/', JSON.stringify(infoLocked))
if (!okInfo) fail++

// 只应该 write 一次（多写一条 <link> 会让主题失效）
const twice = run({ site: 'auto', hour: 10 })
console.log(`${twice.wrote === 1 ? '✅' : '❌'} document.write 次数 = ${twice.wrote}（必须为 1）`)
if (twice.wrote !== 1) fail++

console.log(fail ? `\n❌ ${fail} 项失败` : '\n✅ 全部通过')
process.exit(fail ? 1 : 0)
