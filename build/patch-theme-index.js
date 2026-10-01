/**
 * 构建后处理：把 dist/index.html 里那条**写死的** CSS 引用
 *     <link href=/static/css/oj.<hash>.css rel=stylesheet>
 * 换成一小段「按主题选 CSS」的脚本。
 *
 * 由 package.json 的 postbuild 自动触发（`npm run build` 之后）。
 *
 * ⚠️ 为什么必须是「替换」而不是「在旁边再加一条」：
 *    HtmlWebpackPlugin 把产物 <link> 追加在 </head> 之前，模板 <head> 里的脚本**先**执行，
 *    那时这条 link 还不存在 —— 既删不掉，document.write 出来的 CSS 又会排在它**前面**，
 *    同权重时后者胜 → **亮色永远赢，换主题静默失效**。替换掉就没有竞争对手。
 *
 * ⚠️ 为什么要有那么多断言：这个文件一旦出错，表现是"整个站点没有样式"，
 *    而且看日志什么都发现不了。宁可构建直接失败，也不要悄悄产出一个坏 index.html。
 */
const fs = require('fs')
const path = require('path')

const THEMES = ['light', 'deep', 'sand']
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const INDEX = path.join(DIST, 'index.html')
const CSS_DIR = path.join(DIST, 'static/css')
const MAP_FILE = path.join(__dirname, 'themes/theme-map.json')

function fail (msg) {
  console.error('\n[theme] ❌ ' + msg + '\n')
  process.exit(1)
}

if (!fs.existsSync(INDEX)) fail(`找不到 ${INDEX} —— 先跑 npm run build`)
if (!fs.existsSync(MAP_FILE)) {
  fail(`找不到 ${MAP_FILE}\n` +
       '        它记录「主题名 → dist/static/css 下的文件名」。\n' +
       '        请先跑 `npm run build:themes`（会构建三套并生成它）。')
}

let map
try {
  map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))
} catch (e) {
  fail(`${MAP_FILE} 不是合法 JSON：${e.message}`)
}

// ① map 必须三套齐全；每份都要在 dist 里 —— 只构建了单主题时，
//    自动从 ~/theme_builds/<主题>/ 把另外两份补齐（那正是 build:themes 收集的地方）。
//    补不齐就**直接失败**：宁可构建报错，也不要产出一个指向不存在文件的 index.html（整站没样式）。
const CN = {light: '晴空', deep: '深靛', sand: '暖砂'}
for (const t of THEMES) {
  if (!map[t]) fail(`${MAP_FILE} 里缺 "${t}"`)
  const dst = path.join(CSS_DIR, map[t])
  if (fs.existsSync(dst)) continue

  const src = path.join(process.env.HOME || '', 'theme_builds', t, map[t])
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
    console.log(`[theme] 已从 ${src} 补入 dist（${CN[t]}）`)
  } else {
    fail(`dist 里没有 ${map[t]}（${CN[t]}），本地也找不到 ${src}\n` +
         '        ⇒ 源码改过、CSS 哈希变了。请跑 `npm run build:themes` 重新构建并收集三套，\n' +
         '          否则 index.html 会指向不存在的文件，整站没样式。')
  }
}

// ② 本次构建的 CSS 必须与 map 里当前主题的记录一致（防止用着过期的 map）
const html = fs.readFileSync(INDEX, 'utf8')
const LINK_RE = /<link[^>]*href=["']?\/static\/css\/oj\.[0-9a-f]+\.css["']?[^>]*>/g
const found = html.match(LINK_RE) || []

if (found.length !== 1) {
  fail(`期望 dist/index.html 里恰好有 1 条 oj.<hash>.css 的 <link>，实际 ${found.length} 条。\n` +
       '        产物结构变了？请人工确认后再改本脚本。')
}

const built = /oj\.[0-9a-f]+\.css/.exec(found[0])[0]
const current = process.env.THEME || 'light'
if (map[current] !== built) {
  fail(`本次构建（THEME=${current}）产出的是 ${built}，\n` +
       `        但 theme-map.json 里记录的是 ${map[current]} —— map 过期了。\n` +
       '        请跑 `npm run build:themes` 重新生成。')
}

// ③ 生成脚本并替换
const entries = THEMES.map(t => `${t}:'/static/css/${map[t]}'`).join(',')
const script =
  '<script>(function(){' +
  `var t='${current}';` +                                  // ← set_theme.sh 只改这一个词
  `var CSS={${entries}};` +
  "var m=location.search.match(/[?&]theme=(light|deep|sand)\\b/);" +  // 预览后门
  'if(m)t=m[1];' +
  "document.write('<link rel=stylesheet href=\"'+CSS[t]+'\">');" +
  "document.documentElement.setAttribute('data-theme',t)" +
  '})()</script>'

const out = html.replace(LINK_RE, script)

// ④ 替换后不许再有**写死 CSS 的 <link>** 残留。
//    ⚠️ 不能简单地查字符串 "/static/css/oj." —— 我们刚写进去的映射表里本来就有一堆，
//       要查的是"还有没有 <link> 形态的引用"。
const leftover = out.match(LINK_RE) || []
if (leftover.length !== 0) {
  fail(`替换后 index.html 里仍残留 ${leftover.length} 条写死的 oj.css <link>：\n        ${leftover.join('\n        ')}`)
}

fs.writeFileSync(INDEX, out)

console.log('[theme] ✅ index.html 已改为按主题加载 CSS')
console.log(`       当前主题: ${current}`)
for (const t of THEMES) console.log(`         ${t.padEnd(6)} → ${map[t]}`)
