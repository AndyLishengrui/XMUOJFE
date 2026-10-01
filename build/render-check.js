/**
 * 无浏览器前端渲染自检 —— 直接编译真实的 .vue 源码，在 jsdom 里挂载并断言渲染结果。
 *
 *   cd /OnlineJudgeFE && node build/render-check.js
 *
 * 为什么需要它：这台服务器上**没有 chromium/puppeteer**，前端改动只能靠老师目视。
 * 而"某个组件渲染不出来"这类 bug（例如 2026-10-01 首页公告消失）根本不需要真实浏览器
 * 就能复现 —— 只要把真实 SFC 编译出来、喂真实数据、挂载、看 DOM 就行。
 *
 * ⚠️ 能测什么 / 不能测什么
 *   ✅ 组件挂载是否抛异常、渲染出的文字/结构是否符合预期、v-if/v-for 逻辑
 *   ❌ 布局（jsdom 不做排版：宽度、浮动、sticky 全部不可信）
 *
 * ⚠️ 两个 jsdom 9 的坑（脚本里已处理）
 *   1. `require('jsdom')` 是旧 API（没有 JSDOM 类，要 `jsdom.jsdom()`）
 *   2. `getComputedStyle` 不实现 transitionDelay/animationDelay → Vue 的
 *      getTransitionInfo 读它会 `undefined.split` 崩掉，要补一层 Proxy
 */
const fs = require('fs')
const path = require('path')
const jsdomPkg = require('jsdom')
const compiler = require('vue-template-compiler')

const ROOT = path.resolve(__dirname, '..')

// ── 环境 ─────────────────────────────────────────────────────────
const dom = jsdomPkg.jsdom('<!doctype html><html><body><div id="app"></div></body></html>',
  {features: {FetchExternalResources: false, ProcessExternalResources: false}})
const win = dom.defaultView
global.window = win
global.document = dom
global.navigator = win.navigator

// jsdom 9 缺 transition/animation 的 Delay/Duration → Vue 读到时崩，补上
const realGCS = win.getComputedStyle.bind(win)
win.getComputedStyle = function (el) {
  const st = realGCS(el)
  return new Proxy(st, {
    get (t, prop) {
      const v = t[prop]
      if (v !== undefined) return typeof v === 'function' ? v.bind(t) : v
      if (typeof prop === 'string' && /(Delay|Duration)$/.test(prop)) return '0s'
      return v
    }
  })
}

const Vue = require('vue/dist/vue.common.js')
Vue.config.productionTip = false
Vue.config.devtools = false

// 全局桩：$t/$i18n/$route 与几个全局注册的组件
Vue.prototype.$t = k => k
Vue.prototype.$i18n = {t: k => k}
Vue.prototype.$route = {params: {}, meta: {}, name: 'home', path: '/'}
Vue.prototype.$http = {get: () => Promise.resolve({data: {data: {results: [], total: 0}}})}
Vue.prototype.$router = {push: () => {}}
Vue.filter('localtime', v => v)
Vue.directive('katex', {})
const passthrough = name => Vue.component(name, {render (h) { return h('div', this.$slots.default) }})
;['Panel', 'Button', 'Row', 'Col'].forEach(passthrough)
Vue.component('Page', {render (h) { return h('ul', {staticClass: 'ivu-page'}) }})
Vue.component('ECharts', {render (h) { return h('div') }})

// 真实组件里 import 的这些，编译时换成桩
const STUB_IMPORTS = [
  [/import\s+api\s+from\s+'@oj\/api'/, 'const api = __stub.api'],
  [/import\s+(\w+)\s+from\s+'[^']*Pagination'/, 'const $1 = __stub.Pagination'],
  [/import\s+\{([^}]*)\}\s+from\s+'vuex'/, (m, names) => `const {${names}} = __stub.vuex`],
  [/import\s+ScreenFull\s+from\s+'[^']*'/, 'const ScreenFull = __stub.Noop'],
  [/import\s+(\w+)\s+from\s+'@oj\/views\/user\/\w+'/, 'const $1 = __stub.Noop'],
  [/import\s+\{([^}]*)\}\s+from\s+'@\/utils\/constants'/, (m, names) =>
    `const {${names}} = {PAGE_SIZE_OPTS: [30, 50, 100, 200], DEFAULT_PAGE_SIZE: 30,` +
    ` parsePageSize: (r) => {const n = parseInt(r); return [30, 50, 100, 200].indexOf(n) !== -1 ? n : 30}}`]
]

// ── 编译一个真实 .vue ─────────────────────────────────────────────
function buildSFC (relPath, stubs) {
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8')
  const tplMatch = src.match(/<template>([\s\S]*)<\/template>/)
  const scriptMatch = src.match(/<script>([\s\S]*?)<\/script>/)
  if (!tplMatch || !scriptMatch) throw new Error(relPath + '：没找到 template/script 块')

  const compiled = compiler.compile(tplMatch[1])
  if (compiled.errors && compiled.errors.length) {
    throw new Error(relPath + ' 模板编译失败：\n  ' + compiled.errors.join('\n  '))
  }
  let code = scriptMatch[1].replace(/export default/, 'module.exports =')
  for (const [re, rep] of STUB_IMPORTS) {
    // ⚠️ String.replace 非全局正则只换第一处 —— 同一个 import 出现两次会漏（踩过）
    let prev
    do {
      prev = code
      code = code.replace(re, rep)
    } while (code !== prev)
  }
  if (/^\s*import\s/m.test(code)) {
    throw new Error(relPath + ' 里还有没被替换掉的 import：\n  ' +
      code.match(/^\s*import.*$/mg).join('\n  '))
  }
  const mod = {exports: {}}
  new Function('module', '__stub', code)(mod, stubs)
  const def = mod.exports
  def.render = new Function(compiled.render)
  def.staticRenderFns = compiled.staticRenderFns.map(f => new Function(f))
  return def
}

// ── 自检用例 ──────────────────────────────────────────────────────
function checkAnnouncements () {
  // 真正的接口响应；取不到就退化成一条假数据
  let payload
  const fixture = path.join(__dirname, 'render-check.fixture.json')
  if (fs.existsSync(fixture)) {
    payload = JSON.parse(fs.readFileSync(fixture, 'utf8'))
  } else {
    payload = {error: null, data: {total: 1, results: [{
      id: 1, title: '渲染自检公告', create_time: '2026-01-01T00:00:00Z',
      created_by: {id: 1, username: 'selfcheck'}}]}}
  }

  const Pagination = buildSFC('src/pages/oj/components/Pagination.vue', {})
  Vue.component('Pagination', Pagination)
  Vue.component('PaginationInline', Pagination)
  const Announcements = buildSFC('src/pages/oj/views/general/Announcements.vue', {
    api: {getAnnouncementList: () => Promise.resolve({data: payload})},
    Pagination: Pagination
  })

  const errors = []
  const prevHandler = Vue.config.errorHandler
  Vue.config.errorHandler = e => errors.push(e && e.message ? e.message : String(e))
  const vm = new Vue(Announcements).$mount('#app')
  return new Promise(resolve => setTimeout(() => {
    Vue.config.errorHandler = prevHandler
    resolve({
      name: 'Announcements 能渲染出公告列表',
      ok: vm.announcements.length > 0 &&
          vm.$el.textContent.indexOf('No_Announcements') === -1 &&
          errors.length === 0,
      detail: `公告 ${vm.announcements.length} 条 / 异常 ${errors.length} 个` +
              (errors.length ? '：' + errors.join(' | ') : '') +
              ` / 渲染出：「${vm.$el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)}」`
    })
  }, 250))
}

// 2026-10-01 真实踩过：导航栏加"配色"下拉时，模板里写了 v-if="themeSwitchable"，
// 但**忘了在 computed 里定义它** → 永远为假 → 图标压根不渲染（老师："完全看不见"）。
// eslint 和 webpack 都查不出模板里引用了 undefined 的属性，只有真渲染一遍才知道。
function checkPaletteSwitch () {
  const runWith = (switchable) => {
    global.window.__OJ_THEME__ = {
      css: {}, site: 'auto', pick: switchable ? 'deep' : null,
      resolved: 'deep', switchable
    }
    const Noop = {render (h) { return h('div') }}
    // NavBar 用到的 vuex getter 都得给值，否则模板里 website.website_name 之类会炸
    const g = {
      website: {website_name: '自检', website_footer: '', allow_register: true},
      modalStatus: {visible: false, mode: 'login'},
      user: {},
      profile: {real_name: '自检'},
      isAuthenticated: true,   // 这样右边才有「用户名」按钮，才能验"配色在它右边"
      isAdminRole: false,
      unreadCount: 0
    }
    const vuex = {
      // ⚠️ 必须返回**函数**（mapGetters 的产物是 computed 的 getter），
      //    直接返回值会被 Vue 判成 "Getter is missing for computed property"
      mapGetters: names => {
        const o = {}
        ;(names || []).forEach(n => { o[n] = () => g[n] })
        return o
      },
      mapActions: () => ({getProfile: () => Promise.resolve(), fetchUnreadCount: () => {}, changeModalStatus: () => {}})
    }
    const NavBar = buildSFC('src/pages/oj/components/NavBar.vue', {Noop, vuex})
    const vm = new Vue(NavBar).$mount()
    const html = vm.$el.outerHTML || ''
    vm.$destroy()
    if (vm._notifTimer) clearInterval(vm._notifTimer)
    return html
  }
  let shown = ''
  let hidden = ''
  try {
    shown = runWith(true)
    hidden = runWith(false)
  } catch (e) {
    return Promise.resolve({name: 'NavBar 配色入口', ok: false, detail: '挂载抛异常：' + e.message})
  }
  const rendersWhenSwitchable = shown.indexOf('theme-trigger') !== -1
  const hiddenWhenLocked = hidden.indexOf('theme-trigger') === -1
  // 老师要求：配色入口要在「用户名」按钮**右边**（DOM 顺序决定视觉顺序）
  const afterUserMenu = shown.indexOf('drop-menu') !== -1 &&
                        shown.indexOf('drop-menu') < shown.indexOf('theme-trigger')
  // 铃铛图标必须是这个 iView 构建里**真实存在**的字形（原来写的 ios-notifications-outline 不存在 → 隐形）
  const bellOk = shown.indexOf('android-notifications-none') !== -1
  return Promise.resolve({
    name: 'NavBar 配色入口：位置在用户名右侧 / 站点 auto 时显示、钉死时隐藏 / 铃铛图标有效',
    ok: rendersWhenSwitchable && hiddenWhenLocked && afterUserMenu && bellOk,
    detail: `switchable=true → ${rendersWhenSwitchable ? '显示 ✅' : '没渲染 ❌（computed 少定义了？）'}` +
            ` / false → ${hiddenWhenLocked ? '隐藏 ✅' : '仍显示 ❌'}` +
            ` / 在用户名右侧 → ${afterUserMenu ? '✅' : '❌（顺序不对）'}` +
            ` / 铃铛字形 → ${bellOk ? '✅' : '❌'}`
  })
}

// 排名页：左侧那几列**必须全部**带 fixed:'left'。
// 2026-10-02 真实踩过：ACM 页只给序号/AC数/用时加了 fixed，**漏了「用户名」那列**
// → iView 会把带 fixed 的列统统挪到最前（table.vue:857-865），用户名被挤到"用时"后面，
//   冻结区也跟着错位。这种"漏加一个属性"肉眼很难发现，只能靠机器数。
function checkRankFrozenColumns () {
  const spec = [
    ['src/pages/oj/views/contest/children/OIContestRank.vue', 3, '序号/用户名/总分'],
    ['src/pages/oj/views/contest/children/ACMContestRank.vue', 4, '序号/用户名/AC数/用时']
  ]
  const parts = []
  let ok = true
  for (const [f, expect, label] of spec) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    const n = (src.match(/fixed: 'left'/g) || []).length
    if (n !== expect) ok = false
    parts.push(`${f.split('/').pop()} ${n}/${expect}${n === expect ? '' : ` ❌（应覆盖 ${label}）`}`)
  }
  // mixin 里那个「真名列」也必须冻结，否则一开真名就错位
  const mixin = fs.readFileSync(path.join(ROOT, 'src/pages/oj/views/contest/children/contestRankMixin.js'), 'utf8')
  const mixinN = (mixin.match(/fixed: 'left'/g) || []).length
  if (mixinN !== 1) ok = false
  parts.push(`真名列 ${mixinN}/1`)
  return Promise.resolve({name: '排名页冻结列：左侧静态列全部带 fixed', ok, detail: parts.join(' / ')})
}

// 2026-10-02：导航栏那个铃铛**一直是隐形的** —— 模板里写的 ios-notifications-outline
// 在本项目这个 iView 构建里**没有对应的字形**，渲染出来是个空字形（不是这次改出来的）。
// 这类错误 grep 模板看不出来、eslint/webpack 也查不出来，只能拿字形表逐个核对。
// 凡是往导航栏里"新加一个图标"，先跑这一条。
function checkNavIconGlyphs () {
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/oj/components/NavBar.vue'), 'utf8')
  const iconsFile = fs.readFileSync(path.join(ROOT,
    'node_modules/iview/src/styles/common/iconfont/_ionicons-icons.less'), 'utf8')
  const used = [...new Set((src.match(/<Icon\s+type="[^"]+"/g) || [])
    .map(m => m.replace(/.*type="([^"]+)".*/, '$1')))]
  // ⚠️ 字形表里的写法就是 `@{ionicons-prefix}<名字>:before`（`@{...}` 是 LESS 的变量插值，
  //    花括号是原文的一部分）—— 我第一次漏写了 `{`，结果 10 个图标全报"不存在"。
  const missing = used.filter(n => iconsFile.indexOf('@{ionicons-prefix}' + n + ':before') === -1)
  return Promise.resolve({
    name: '导航栏图标：模板里用到的字形都真实存在',
    ok: missing.length === 0 && used.length > 0,
    detail: `用到 ${used.length} 个（${used.join(', ')}）` +
            (missing.length ? ` ❌ 这个构建里不存在：${missing.join(', ')}` : ' ✅ 全部存在')
  })
}

// ── 跑 ───────────────────────────────────────────────────────────
const cases = [checkAnnouncements, checkPaletteSwitch, checkRankFrozenColumns, checkNavIconGlyphs]

;(async () => {
  const results = []
  for (const c of cases) results.push(await c())
  return results
})().then(results => {
  let failed = 0
  for (const r of results) {
    if (!r.ok) failed++
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}\n     ${r.detail}`)
  }
  console.log(failed ? `\n❌ ${failed}/${results.length} 项失败` : `\n✅ ${results.length}/${results.length} 项通过`)
  process.exit(failed ? 1 : 0)
}).catch(e => {
  console.error('❌ 自检脚本本身出错：', e)
  process.exit(1)
})
