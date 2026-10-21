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
// node 16 没有全局 CustomEvent（浏览器里是 window.CustomEvent）—— 被测源码写的是
// 裸 `new CustomEvent(...)`，所以这里把 jsdom 那份挂到全局，保证与浏览器同语义。
global.CustomEvent = win.CustomEvent

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
    ` parsePageSize: (r) => {const n = parseInt(r); return [30, 50, 100, 200].indexOf(n) !== -1 ? n : 30},` +
    ` CONTEST_TYPE: {PUBLIC: 0, PASSWORD_PROTECTED: 1, PRIVATE: 2},` +
    ` CONTEST_STATUS_REVERSE: {'-1': {name: 'Ended', color: 'gray'}, '0': {name: 'Under way', color: 'green'},` +
    ` '1': {name: 'Not started', color: 'blue'}}}`],
  // 具名导入：`import {a, b} from '@/utils/theme'`
  [/import\s+\{([^}]*)\}\s+from\s+'@\/utils\/theme'/, (m, names) => `const {${names}} = __stub.theme`],
  // 兜底：`@/utils/xxx` 默认导出 → 由 __stub.xxx 提供（必须放在 constants 那条**之后**）
  [/import\s+(\w+)\s+from\s+'@\/utils\/(\w+)'/, (m, name, mod) => `const ${name} = __stub.${mod}`]
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
    const NavBar = buildSFC('src/pages/oj/components/NavBar.vue',
      {Noop, vuex, theme: {applyTheme: () => true}})
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

// 2026-10-02 老师报「从题目页 / 排名页切到实验就卡顿」的根因（两个，都在 ContestList.vue）：
//   ① 取数写在 beforeRouteEnter 的 .then() 里 —— vue-router 要等 next()，而 next() 只在
//      请求回来后调用 ⇒ **整次跳转被一次网络往返挡住**；期间 URL 不变、旧页面还盖在上面、
//      没有任何 loading ⇒ 用户点了菜单像"卡死"。
//   ② watch('$route') 会先于 router-view 重渲染执行 ⇒ **即将被销毁的旧实例**也触发一次
//      ⇒ 每次跳转发两条一模一样的请求，过期响应还可能覆盖新列表。
// 这两个毛病看代码看不出来、只有真去切页面才感受得到（日志里靠 referer 才认出来），
// 所以钉成机器检查：改回去就报错。
function checkContestListNav () {
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/oj/views/contest/ContestList.vue'), 'utf8')
  const blockingGuard = /beforeRouteEnter\s*\(/.test(src)
  const routeWatcher = /['"]\$route['"]\s*[:(]/.test(src)
  // watch('$route') 本身是对的（见组件里的注释：两条路由记录共用同一个组件，
  // beforeRouteUpdate 在这两个页面互切时**不触发**），但必须带"旧实例别取数"的判定。
  const watcherGuarded = !routeWatcher || /_isDestroyed|_isBeingDestroyed/.test(src)
  return Promise.resolve({
    name: '实验/题库列表：跳转不被网络请求挡住 / 每次跳转只取一次数（静态）',
    ok: !blockingGuard && watcherGuarded,
    detail: `beforeRouteEnter（会挡住跳转）→ ${blockingGuard ? '❌ 又出现了' : '没有 ✅'}` +
            ` / watch("$route") 的"旧实例别取数"判定 → ${watcherGuarded ? '有 ✅' : '❌ 丢了（会白发请求）'}`
  })
}

// 上面那条是"看源码"的静态检查；这条是**真跑一遍路由**的行为验证（vue-router 就在 node_modules 里）。
// 用一个**永远不 resolve** 的取数 promise 来模拟"网慢/请求被堵"：
//   · 旧代码把取数放在 beforeRouteEnter 的 .then() 里 ⇒ push() 永远不完成（= 老师看到的"点了没反应"）
//   · 旧代码用 watch('$route') ⇒ 同组件换路由记录时会多取一次（垂死的旧实例也触发）
function checkContestListNavBehavior () {
  const VueRouter = require('vue-router')
  if (!checkContestListNavBehavior._installed) {
    Vue.use(VueRouter)
    checkContestListNavBehavior._installed = true
  }
  const prevLoading = Vue.prototype.$Loading
  Vue.prototype.$Loading = {start () {}, finish () {}, error () {}}

  const calls = []
  const api = {
    getContestList (offset, limit, query) {
      calls.push((query && query.category) || '')
      return new Promise(() => {})       // 永不 resolve
    }
  }
  const vuex = {
    mapGetters: names => {
      const o = {}
      ;(names || []).forEach(n => { o[n] = () => undefined })
      return o
    }
  }
  const Noop = {render (h) { return h('div') }}
  const ContestList = buildSFC('src/pages/oj/views/contest/ContestList.vue',
    {api, Pagination: Noop, vuex, Noop,
     utils: {filterEmptyValue: o => o},
     time: {utcToLocal: () => ''}})
  const Dummy = {render (h) { return h('div', 'dummy') }}
  const router = new VueRouter({
    mode: 'abstract',   // jsdom 9 的 pushState 不靠谱，abstract 模式不碰 URL
    routes: [
      {path: '/problem', component: Dummy},
      {path: '/contest', component: ContestList, meta: {category: 'experiment'}},
      {path: '/question-bank', component: ContestList, meta: {category: 'question_bank'}}
    ]
  })
  const vm = new Vue({router, render: h => h('router-view')}).$mount()

  // ⚠️ vue-router 3.0.1 的 push() **不返回 Promise**（3.1.0 才加），只能用回调式。
  const push = to => new Promise(resolve => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 600)
    router.push(to,
      () => { clearTimeout(timer); resolve('OK') },
      () => { clearTimeout(timer); resolve('ERR') })
  })

  // ⚠️ 取样前必须 settle：组件里把取数推迟到了 $nextTick（为了排掉被销毁的旧实例），
  //    而 push 的 onComplete 早于那个 nextTick 回调 —— 不 settle 会数少一条（踩过）。
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  const step = async to => { const res = await push(to); await settle(); return res }

  return (async () => {
    let r = []
    try {
      r.push(await step('/problem'))            // 起点：另一个组件
      r.push(await step('/contest'))            // ① 跨组件进实验页
      const n1 = calls.length
      r.push(await step('/question-bank'))      // ② 同组件换路由记录
      const n2 = calls.length
      r.push(await step('/question-bank?page=2')) // ③ 同记录、只改 query
      const n3 = calls.length
      r.push(await step('/problem'))              // ④ 离开实验页（旧实例被销毁）
      const n4 = calls.length
      const notBlocked = r.every(x => x === 'OK')
      const oneShot = n1 === 1 && n2 === 2 && n3 === 3 && n4 === 3
      vm.$destroy()
      Vue.prototype.$Loading = prevLoading
      return {
        name: '实验/题库列表：跳转不被请求挡住 + 每次跳转只取一次数（真实跑路由）',
        ok: notBlocked && oneShot,
        detail: `取数 promise 永不 resolve 时：进实验页=${r[1]} 换记录=${r[2]} 换query=${r[3]} 离开=${r[4]}` +
                `（OK=没被挡住）/ 取数次数 ①${n1}→②${n2}→③${n3}→④${n4}` +
                `（应 1→2→3→3：每进一次取一次，**离开时不该再取**）`
      }
    } catch (e) {
      vm.$destroy()
      Vue.prototype.$Loading = prevLoading
      return {name: '实验/题库列表：跳转不被请求挡住 + 每次跳转只取一次数（真实跑路由）',
              ok: false, detail: '用例本身异常：' + e.message}
    }
  })()
}

// 2026-10-05：老师要「实验/题库/考试」在列表标题前各有图标（旧卡片列表开头那张奖杯，改成
// iView Table 后丢了）。图标是在标题列的 render 里 h('Icon', {type}) 生成的 —— **模板里 grep 不到**，
// 所以只能真跑一遍 render、按类型逐个断言；顺带照 checkNavIconGlyphs 的办法核对字形在本构建里真的存在。
function checkContestTypeIcons () {
  if (!Vue.options.components.Icon) {
    Vue.component('Icon', {props: ['type'], render (h) { return h('i', {class: 'ivu-icon ivu-icon-' + this.type}) }})
  }
  const api = {getContestList: () => Promise.resolve({data: {data: {results: [], total: 0}}})}
  const vuex = {mapGetters: names => {const o = {}; (names || []).forEach(n => {o[n] = () => undefined}); return o}}
  const Noop = {render (h) { return h('div') }}
  const prevLoading = Vue.prototype.$Loading
  Vue.prototype.$Loading = {start () {}, finish () {}, error () {}}
  const ContestList = buildSFC('src/pages/oj/views/contest/ContestList.vue',
    {api, Pagination: Noop, vuex, Noop, utils: {filterEmptyValue: o => o}, time: {utcToLocal: () => ''}})
  const vm = new Vue(ContestList).$mount()
  const col = vm.columns.filter(c => c.key === 'title')[0]
  const h = vm.$createElement
  const spec = [
    [{is_exam: false, is_question_bank: false}, 'trophy', 'exp'],
    [{is_exam: false, is_question_bank: true}, 'trophy', 'qb'],
    [{is_exam: true, is_question_bank: false}, 'trophy', 'exam'],
    [{is_exam: true, is_question_bank: true}, 'trophy', 'qb']   // 同时为真 → 按「题库」
  ]
  const got = spec.map(([flags, wantType, wantCls]) => {
    const row = Object.assign({id: 1, title: 'T', contest_type: 1}, flags)
    const vnode = col.render(h, {row})
    const icon = vnode.children[0]
    const t = icon && icon.componentOptions ? icon.componentOptions.propsData.type : null
    const cls = icon && icon.data ? (icon.data.staticClass || icon.data.class || '') : ''
    return {t, cls: String(cls), wantType, wantCls}
  })
  vm.$destroy()
  Vue.prototype.$Loading = prevLoading
  const iconsFile = fs.readFileSync(path.join(ROOT,
    'node_modules/iview/src/styles/common/iconfont/_ionicons-icons.less'), 'utf8')
  const glyphs = [...new Set(got.map(g => g.wantType))]
  const missing = glyphs.filter(n => iconsFile.indexOf('@{ionicons-prefix}' + n + ':before') === -1)
  const ok = got.every(g => g.t === g.wantType && g.cls.indexOf(g.wantCls) !== -1) && missing.length === 0
  return Promise.resolve({
    name: '实验/题库列表：标题前的类型图标（考试=奖杯 / 题库=书 / 实验=code）',
    ok,
    detail: got.map((g, i) => `#${i + 1} ${g.cls.trim() || '?'}→${g.t}` +
      (g.t === g.wantType && g.cls.indexOf(g.wantCls) !== -1 ? '' : `❌(应${g.wantType}/${g.wantCls})`)).join(' / ') +
      (missing.length ? ` / ❌ 字形不存在：${missing.join(', ')}` : ' / 字形全部存在 ✅')
  })
}

/**
 * 换配色必须是「不刷新页面」的换 <link>（2026-10-11 学生事故的回归自检）。
 *
 * 事故：NavBar.changeTheme 原来是 window.location.reload()，而"把代码存进 localStorage"
 * 的钩子是路由的 beforeRouteLeave —— **整页刷新不触发它** ⇒ 题目页写了没保存的代码被清空。
 *
 * 这个用例把真实的 src/utils/theme.js 拿来在 jsdom 里跑，断言：
 *   ① resolveTheme 认得三套原名、非法值返回 null
 *   ② applyTheme 会插入新主题 <link>、摘掉旧 <link>、更新 html[data-theme] / __OJ_THEME__
 *   ③ 派发 oj-theme-change 事件（Monaco 靠它跟色）
 *   ④ NavBar 源码里**不再有 location.reload**，且确实接了 applyTheme
 */
function checkThemeSwitch () {
  // 把真实源码的 `export ` 去掉后在 jsdom 里执行
  let code = fs.readFileSync(path.join(ROOT, 'src/utils/theme.js'), 'utf8')
  code = code.replace(/^export\s+/gm, '')
  const themeApi = new Function(code +
    '\n;return {siteScheme: siteScheme, resolveTheme: resolveTheme, applyTheme: applyTheme}')()
  const themeApiOk = themeApi && typeof themeApi.applyTheme === 'function'

  // 清场 + 造一个"当前是晴空"的现场
  const stale = dom.querySelectorAll('link[href*="/static/css/oj."]')
  Array.prototype.slice.call(stale).forEach(l => { if (l.parentNode) l.parentNode.removeChild(l) })
  const oldLink = dom.createElement('link')
  oldLink.setAttribute('rel', 'stylesheet')
  oldLink.setAttribute('href', '/static/css/oj.light.css')
  dom.head.appendChild(oldLink)

  win.__OJ_THEME__ = {
    css: {light: '/static/css/oj.light.css', deep: '/static/css/oj.deep.css', sand: '/static/css/oj.sand.css'},
    site: 'auto', pick: null, resolved: 'light', switchable: true
  }
  let detail = null
  const onEvt = e => { detail = e.detail }
  win.addEventListener('oj-theme-change', onEvt)

  const resolveOk = themeApiOk &&
    themeApi.resolveTheme('deep') === 'deep' &&
    themeApi.resolveTheme('light') === 'light' &&
    themeApi.resolveTheme('bogus') === null

  if (themeApiOk) themeApi.applyTheme('deep')
  // jsdom 不加载外链 ⇒ onload 不会自己触发，手动模拟浏览器"新表已加载"
  const fresh = dom.querySelector('link[href="/static/css/oj.deep.css"]')
  if (fresh && typeof fresh.onload === 'function') fresh.onload()
  win.removeEventListener('oj-theme-change', onEvt)

  const oldGone = !dom.querySelector('link[href="/static/css/oj.light.css"]')
  const attrOk = dom.documentElement.getAttribute('data-theme') === 'deep'
  const stateOk = win.__OJ_THEME__.pick === 'deep' && win.__OJ_THEME__.resolved === 'deep'
  const evtOk = !!(detail && detail.theme === 'deep')

  const navSrc = fs.readFileSync(path.join(ROOT, 'src/pages/oj/components/NavBar.vue'), 'utf8')
  const noReload = navSrc.indexOf('location.reload') === -1 && /applyTheme\s*\(/.test(navSrc)

  const bad = []
  if (!themeApiOk) bad.push('theme.js 里找不到 applyTheme')
  if (!resolveOk) bad.push('resolveTheme 结果不对')
  if (!fresh) bad.push('没插入新主题 <link>')
  if (!oldGone) bad.push('旧主题 <link> 没被摘掉')
  if (!attrOk) bad.push('html[data-theme] 没更新')
  if (!stateOk) bad.push('window.__OJ_THEME__ 没同步')
  if (!evtOk) bad.push('没派发 oj-theme-change 事件')
  if (!noReload) bad.push('NavBar 仍在整页刷新 / 没接 applyTheme')

  return {
    name: '不刷新换肤（换 <link> + 事件 + 不再 reload）',
    ok: bad.length === 0,
    detail: bad.length ? '❌ ' + bad.join('；')
      : '换表/摘旧表/data-theme/状态/事件/去 reload 全部 ✅'
  }
}

/**
 * 草稿兜底的回归自检：题目页必须把代码在"刷新/关闭/打字"时都存进 localStorage，
 * 否则一次 F5 或换配色就白写了。这里只做**源码连线**断言（真正写盘要挂载整个 Problem.vue，
 * 在 jsdom 里代价太大）；配合上面的换肤用例，覆盖住这次事故的两条根因。
 */
function checkDraftGuard () {
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/oj/views/problem/Problem.vue'), 'utf8')
  const need = [
    ["window.addEventListener('beforeunload', this.saveDraftNow)", '刷新/关闭时立即存草稿'],
    ["window.addEventListener('oj-theme-change', this.onSiteThemeChange)", '换配色时编辑器跟色'],
    ["window.removeEventListener('beforeunload', this.saveDraftNow)", 'beforeDestroy 摘掉监听'],
    ['saveDraftNow () {', 'saveDraftNow 方法'],
    ['scheduleDraftSave', '打字防抖存草稿'],
    ['buildProblemCodeKey(this.problem._id, this.$route.params.contestID)', '与 beforeRouteLeave 同一把 key']
  ]
  const missing = need.filter(([s]) => src.indexOf(s) === -1).map(([, label]) => label)
  return {
    name: '题目页草稿兜底（刷新/关闭/打字都存）',
    ok: missing.length === 0,
    detail: missing.length ? '❌ 缺：' + missing.join('、') : '6 处连线全部到位 ✅'
  }
}

/**
 * 换肤的**边界用例**回归自检（2026-10-13 老师报的"点了配色整站没样式"）。
 *
 * 上面 checkThemeSwitch 只走"点到另一套 + 新表加载成功"这一条顺路。
 * 两条会让**旧表被摘掉却没有新表顶上**的岔路它都测不到：
 *   ① 点「当前就是的那一套」（未登入首访者 pick=null，下拉当前项是「自动」，最容易点到）
 *   ② 新表加载失败（onerror）/ 慢到来不及
 * —— 任何一条走岔，页面上就一张主题 CSS 都不剩 = 整站白板。
 */
function checkThemeSafeSwap () {
  let code = fs.readFileSync(path.join(ROOT, 'src/utils/theme.js'), 'utf8')
  code = code.replace(/^export\s+/gm, '')
  const api = new Function(code + '\n;return {applyTheme: applyTheme}')()

  const themeLinks = () => Array.prototype.slice
    .call(dom.querySelectorAll('link[href*="/static/css/oj."]'))
    .map(l => l.getAttribute('href'))

  // 造现场：当前生效的是 <theme>，用户点了 <click>；fire 用来模拟浏览器的加载结果
  function scenario (theme, click, fire) {
    Array.prototype.slice.call(dom.querySelectorAll('link[href*="/static/css/"]'))
      .forEach(l => { if (l.parentNode) l.parentNode.removeChild(l) })
    const oldLink = dom.createElement('link')
    oldLink.setAttribute('rel', 'stylesheet')
    oldLink.setAttribute('href', '/static/css/oj.' + theme + '.css')
    dom.head.appendChild(oldLink)
    win.__OJ_THEME__ = {
      css: {
        light: '/static/css/oj.light.css',
        deep: '/static/css/oj.deep.css',
        sand: '/static/css/oj.sand.css'
      },
      site: 'auto', pick: null, resolved: theme, switchable: true
    }
    api.applyTheme(click)
    // jsdom 不加载外链：新表的结局要手动喂进来，喂完**再**取样式表清单
    if (fire) {
      const fresh = dom.querySelector('link[href="/static/css/oj.' + fire.target + '.css"]')
      if (fresh && typeof fresh[fire.event] === 'function') fresh[fire.event]()
    }
    return themeLinks()
  }

  const bad = []

  // ① 点当前生效的那一套 —— 必须还有那张表在场（曾经会一张不剩 = 整站白板）
  const same1 = scenario('sand', 'sand')
  if (same1.length === 0) bad.push('点「当前这套」后一张主题表都不剩（整站白板）')

  // ② 点「自动」而自动解析出来的正是当前这套 —— 同样不能摘表
  const same2 = scenario('sand', 'auto')
  if (same2.length === 0) bad.push('点「自动」命中当前这套后一张主题表都不剩')

  // ③ 新表 onerror（离线/404）—— 旧表必须还在，坏掉的新表要被撤掉
  const err = scenario('sand', 'deep', {target: 'deep', event: 'onerror'})
  if (err.indexOf('/static/css/oj.sand.css') === -1) bad.push('新表加载失败后旧表被摘了')
  if (err.indexOf('/static/css/oj.deep.css') >= 0) bad.push('加载失败的新表没撤掉')

  // ④ 顺路确认没把正常路径改坏：新表加载成功 → 换表 + 旧表摘掉
  const ok = scenario('sand', 'deep', {target: 'deep', event: 'onload'})
  if (ok.indexOf('/static/css/oj.deep.css') === -1) bad.push('正常路径：新表没留下')
  if (ok.indexOf('/static/css/oj.sand.css') >= 0) bad.push('正常路径：旧表没摘掉')

  // ⑤ 源码层面：不许再有"超时就把旧表摘掉"的兜底（注释里出现不算）
  const codeNoComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  if (codeNoComments.indexOf('setTimeout') >= 0) bad.push('仍有 setTimeout 摘表兜底')

  return {
    name: '换肤边界：点当前这套 / 新表加载失败，都不能丢样式',
    ok: bad.length === 0,
    detail: bad.length ? '❌ ' + bad.join('；')
      : '同套不摘表 / 失败保留旧表并撤新表 / 无超时摘表 ✅'
  }
}

// ── Monaco 按需加载：打开页面不许拉编辑器 ──────────────────────────
// 2026-10-14：原来 index.html 无条件 require(['vs/editor/editor.main'])，而这是全站共用的
// SPA 壳 ⇒ 每次进站（含首页）白拉 editor.api 3.67MB/gzip 945KB，把 ~0.5MB/s 的出口吃光。
// 这条用例钉死两件事：① 页面打开时**一个 Monaco 脚本都不注入**；② MonacoEditor 走 __loadMonaco。
async function checkMonacoLazy () {
  const bad = []
  const html = fs.readFileSync(path.join(ROOT, 'src/pages/oj/index.html'), 'utf8')
  const block = (html.match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, ''))
    .find(b => b.indexOf('__loadMonaco') >= 0)
  if (!block) {
    return {name: 'Monaco 按需加载：打开页面不拉编辑器', ok: false,
            detail: '❌ index.html 里找不到定义 window.__loadMonaco 的 <script>'}
  }

  const savedRequire = win.require
  const savedMonaco = win.monaco
  Array.prototype.slice.call(dom.querySelectorAll('head script')).forEach(s => s.parentNode.removeChild(s))
  win.monaco = undefined

  new Function(block)()

  const injected = () => Array.prototype.slice.call(dom.querySelectorAll('head script'))
    .map(s => s.getAttribute('src')).filter(Boolean)

  // ① 打开页面（还没人调 __loadMonaco）—— 不许注入任何脚本
  const atOpen = injected()
  if (atOpen.length !== 0) bad.push('打开页面就注入了脚本（应等到调用时）：' + atOpen.join(', '))

  // ② 第一次调用 —— 只许注入 loader.js，不许直接注入 editor.main
  let resolved = null
  win.__loadMonaco().then(m => { resolved = m })
  const afterFirst = injected()
  if (afterFirst.filter(s => s.indexOf('loader.js') >= 0).length !== 1) {
    bad.push('调用后没注入 loader.js：' + (afterFirst.join(', ') || '(无)'))
  }
  if (afterFirst.some(s => s.indexOf('editor.main') >= 0)) bad.push('页面直接注入了 editor.main（应由 AMD loader 拉）')

  // ③ 模拟 loader.js 执行 + editor.main 就绪（jsdom 不执行外链，手动喂）
  const loaderEl = Array.prototype.slice.call(dom.querySelectorAll('head script'))
    .filter(s => (s.getAttribute('src') || '').indexOf('loader.js') >= 0)[0]
  win.require = function (deps, cb) {
    if (deps && deps[0] === 'vs/editor/editor.main') {
      win.monaco = {editor: {}, languages: {}, KeyCode: {}, KeyMod: {}}
      cb()
    }
  }
  if (loaderEl && typeof loaderEl.onload === 'function') loaderEl.onload()
  await new Promise(resolve => setImmediate(resolve))

  if (resolved !== win.monaco || !win.monaco) bad.push('__loadMonaco() 没有 resolve 出 window.monaco')

  // ④ 幂等：再调一次不许重复注入
  win.__loadMonaco()
  if (injected().filter(s => s.indexOf('loader.js') >= 0).length !== 1) bad.push('重复调用会重复注入 loader.js')

  // ⑤ 组件侧：必须走 __loadMonaco；theme watcher 必须判空（按需加载后 monaco 可能还没到）
  const ed = fs.readFileSync(path.join(ROOT, 'src/pages/oj/components/MonacoEditor.vue'), 'utf8')
  if (ed.indexOf('__loadMonaco') === -1) bad.push('MonacoEditor.vue 没调 window.__loadMonaco')
  const tw = ed.match(/'theme'\s*\(newVal\)\s*\{[\s\S]*?\n\s{6}\}/)
  if (!tw || tw[0].indexOf('if (window.monaco)') === -1) {
    bad.push('MonacoEditor.vue 的 theme watcher 没判空（Monaco 未就绪时会抛错）')
  }

  win.require = savedRequire
  win.monaco = savedMonaco

  return {
    name: 'Monaco 按需加载：打开页面不拉编辑器',
    ok: bad.length === 0,
    detail: bad.length ? '❌ ' + bad.join('；')
      : '开页 0 注入 / 调用才拉 loader.js / 幂等 / 组件已改 ✅'
  }
}

// ── 未读消息轮询间隔：不许再回到 30 秒 ──────────────────────────────
// 2026-10-14：30 秒的轮询占了**全站 40% 的请求**（高峰 20 分钟 6385/16001），而出口只有 ~0.5MB/s。
// 拉长到 2 分钟。这条用例把间隔钉死，防止以后有人手滑改回去。
function checkUnreadPollInterval () {
  const bad = []
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/oj/components/NavBar.vue'), 'utf8')
  const m = src.match(/const\s+UNREAD_POLL_INTERVAL_MS\s*=\s*(\d+)/)
  if (!m) {
    bad.push('NavBar.vue 没有 UNREAD_POLL_INTERVAL_MS 常量')
  } else if (parseInt(m[1], 10) < 120000) {
    bad.push(`轮询间隔只有 ${m[1]}ms（要求 ≥120000ms，即 2 分钟）`)
  }
  const line = src.split('\n').find(l => l.indexOf('setInterval') >= 0 && l.indexOf('fetchUnreadCount') >= 0) || ''
  if (!line) {
    bad.push('找不到 unread_count 的 setInterval')
  } else {
    if (line.indexOf('UNREAD_POLL_INTERVAL_MS') < 0) bad.push('setInterval 没走常量：' + line.trim())
    if (/\b\d{4,}\b/.test(line)) bad.push('setInterval 里还写死了数字：' + line.trim())
  }
  return {
    name: '未读消息轮询：间隔 ≥2 分钟且走常量',
    ok: bad.length === 0,
    detail: bad.length ? '❌ ' + bad.join('；')
      : `间隔 ${m ? m[1] : '?'}ms（原 30000ms）✅ — 请求量降到 1/4`
  }
}

/**
 * 2026-10-16：比赛列表的「任课老师」由**自由文本框**改成**下拉菜单**。
 *
 * 老师原话：「虽然已经可以支持按任课老师搜索，但是很不好用……可否改为列表框，这样我点击
 * 鼠标就可以选择，不用打任课老师的名字，太慢了。」后端 owner 过滤早就有（2026-09-22），
 * 这次只是把 UI 换成点选。
 *
 * 断言（真编译 ContestList.vue + 真跑 vue-router）：
 *   ① 候选项来自 /api/contest_teachers，渲染出「全部」+ 全部老师
 *   ② 点某位老师 → 路由变成 ?owner=<username> 且 page 回到 1
 *   ③ 触发器显示中文名；`?owner=中文名`（老分享链接的形态）也照样显示中文名、不回落到「任课老师」
 *   ④ 题库页上这个筛选**依然不显示**
 *
 * ⚠️ iView 的 Dropdown 在 jsdom 里跑不起来（`require('iview')` 直接挂死），所以这里用
 *    **忠实照抄 iView 契约**的替身：见 node_modules/iview/src/components/dropdown/dropdown-item.vue
 *    —— 点击 item → 向上找 name==='Dropdown' 的祖先 → `$emit('on-click', this.name)`，
 *    Dropdown 再接住往上抛。也就是说本用例验的是**模板接线**（v-for / :name / @on-click），
 *    不是 iView 自己的渲染。该契约另有旁证：同一栏的「实验」「状态」两个筛选线上就是这么用的。
 */
function checkTeacherFilterDropdown () {
  const VueRouter = require('vue-router')
  if (!checkTeacherFilterDropdown._installed) {
    Vue.use(VueRouter)
    checkTeacherFilterDropdown._installed = true
  }
  const prevLoading = Vue.prototype.$Loading
  Vue.prototype.$Loading = {start () {}, finish () {}, error () {}}

  // 线上真实的 8 位任课老师（/api/contest_teachers?category=experiment 的原样返回）
  const TEACHERS = [
    {username: 'andy', real_name: '李胜睿', count: 15},
    {username: 'DongLin', real_name: '曹冬林', count: 4},
    {username: 'hlzeng', real_name: '曾华琳', count: 4},
    {username: 'ZengMing', real_name: '曾鸣', count: 4},
    {username: 'HJWang', real_name: '王鸿吉', count: 4},
    {username: 'HRChen', real_name: '陈胤燃', count: 4},
    {username: 'QYSong', real_name: '宋庆禹', count: 3},
    {username: 'lkhqz', real_name: '刘昆宏', count: 1}
  ]

  const findDropdownUpward = vm => {
    let p = vm.$parent
    while (p) {
      if (p.$options.name === 'Dropdown') return p
      p = p.$parent
    }
    return null
  }
  const DropdownStub = {
    name: 'Dropdown',
    render (h) {
      return h('div', {staticClass: 'ivu-dropdown'}, [
        h('div', {staticClass: 'ivu-dropdown-rel'}, this.$slots.default),
        h('ul', {staticClass: 'ivu-dropdown-menu'}, this.$slots.list)
      ])
    },
    mounted () { this.$on('on-click', key => this.$emit('on-click', key)) }
  }
  const DropdownItemStub = {
    name: 'DropdownItem',
    props: {name: [String, Number]},
    render (h) {
      return h('li', {staticClass: 'ivu-dropdown-item', on: {click: this.handleClick}}, this.$slots.default)
    },
    methods: {
      handleClick () {
        const p = findDropdownUpward(this)
        if (p) p.$emit('on-click', this.name)
      }
    }
  }
  // 真实 Panel 用了具名 slot（title/extra），render-check 里的全局 Panel 桩只渲染 default，
  // 会把整条筛选栏丢掉 → 这里用局部注册的 Panel 把三个 slot 都渲染出来。
  const PanelStub = {render (h) { return h('div', [this.$slots.title, this.$slots.extra, this.$slots.default]) }}

  // 仿后端的 category 语义：实验页 8 位老师，题库页只有 1 位（真实数据就是这样）。
  // 这个差异正是 2026-10-16 那个 bug 的来源 —— 见下面第 ⑤ 条断言。
  const api = {
    getContestList: () => Promise.resolve({data: {data: {results: [], total: 0}}}),
    getContestTeachers: (params) => Promise.resolve({
      data: {data: (params || {}).category === 'question_bank' ? [TEACHERS[0]] : TEACHERS}
    })
  }
  const vuex = {mapGetters: names => {const o = {}; (names || []).forEach(n => {o[n] = () => undefined}); return o}}
  const Noop = {render (h) { return h('div') }}
  const ContestList = buildSFC('src/pages/oj/views/contest/ContestList.vue',
    {api, Pagination: Noop, vuex, Noop, utils: {filterEmptyValue: o => o}, time: {utcToLocal: () => ''}})
  ContestList.components = Object.assign({}, ContestList.components, {
    Panel: PanelStub,
    Dropdown: DropdownStub,
    'Dropdown-menu': {render (h) { return h('ul', {staticClass: 'ivu-dropdown-menu'}, this.$slots.default) }},
    DropdownMenu: {render (h) { return h('ul', {staticClass: 'ivu-dropdown-menu'}, this.$slots.default) }},
    'Dropdown-item': DropdownItemStub,
    DropdownItem: DropdownItemStub
  })

  const Dummy = {render (h) { return h('div', 'dummy') }}
  const router = new VueRouter({
    mode: 'abstract',
    routes: [
      {name: 'problem-list', path: '/problem', component: Dummy},
      {name: 'contest-list', path: '/contest', component: ContestList, meta: {category: 'experiment'}},
      {name: 'question-bank-list', path: '/question-bank', component: ContestList, meta: {category: 'question_bank'}}
    ]
  })
  const vm = new Vue({router, render: h => h('router-view')})
  vm.$mount()
  // ⚠️ `.$mount()` 不带 el 时组件挂在**游离**节点上，document.querySelectorAll 一个都找不到
  //    （踩过：菜单项恒为空数组）。必须真的挂进 body。
  document.body.appendChild(vm.$el)

  const push = to => new Promise(resolve => {
    const timer = setTimeout(() => resolve('TIMEOUT'), 600)
    router.push(to, () => { clearTimeout(timer); resolve('OK') }, () => { clearTimeout(timer); resolve('ERR') })
  })
  const settle = () => new Promise(resolve => setTimeout(resolve, 30))

  // 老师那个下拉的菜单：按「含某位老师中文名」认出来（同栏另外两个 Dropdown 也产出同样的 li）
  const teacherMenu = () => [...document.querySelectorAll('ul.ivu-dropdown-menu')]
    .filter(ul => ul.textContent.indexOf('李胜睿') !== -1)[0] || null
  const menuTexts = () => {
    const ul = teacherMenu()
    return ul ? [...ul.querySelectorAll('li.ivu-dropdown-item')].map(li => li.textContent.trim()) : []
  }
  const contestListVm = () => {
    let found = null
    const walk = c => c.forEach(x => { if (x.$options.name === 'contest-list') found = x; else walk(x.$children) })
    walk(vm.$children)
    return found
  }

  const cleanup = () => { vm.$destroy(); Vue.prototype.$Loading = prevLoading }

  return (async () => {
    const bad = []
    try {
      // 🔥 起点刻意放在**题库页**（复刻老师的真实路径：他先停在题库，再切到实验页）。
      //    这一点是能否抓到那个 bug 的关键 —— 若从实验页起步，第一次 mounted 拉到的
      //    就已经是实验页那份名单，后面再怎么切都看不出来（我第一版就是这么写的，
      //    结果拿**有 bug 的代码**跑也全绿）。
      await push('/question-bank')
      await settle()
      if (teacherMenu()) bad.push('题库页上「任课老师」下拉仍然显示')     // ④
      await push('/contest')
      await settle()
      const inst = contestListVm()
      if (!inst) { cleanup(); return {name: '比赛列表：任课老师下拉菜单', ok: false, detail: '❌ 挂载不出 contest-list 实例'} }

      // ① 候选项：**题库→实验切回来**之后必须仍是实验页那份 8 位
      //    （两条路由共用同一个组件实例、mounted 不重跑，若名单只在 mounted 取一次，
      //     这里拿到的就是题库那份——只有 1 位老师——老师说的"只剩下李胜睿"。）
      const want = ['m.All'].concat(TEACHERS.map(t => t.real_name))
      const got = menuTexts()
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        bad.push(`菜单项 ${JSON.stringify(got)} ≠ 期望 ${JSON.stringify(want)}`)
      }

      // ② 点「曾鸣」→ 路由 owner=ZengMing、page 回到 1
      if (inst.page === 1) inst.page = 3        // 先制造一个非 1 的页码，验「改筛选会回第一页」
      const ul = teacherMenu()
      const li = ul && [...ul.querySelectorAll('li.ivu-dropdown-item')].filter(x => x.textContent.trim() === '曾鸣')[0]
      if (!li) bad.push('菜单里找不到「曾鸣」这一项')
      else li.click()
      await settle()
      const q = vm.$route.query
      if (q.owner !== 'ZengMing') bad.push(`点「曾鸣」后 owner=${JSON.stringify(q.owner)}，应 'ZengMing'`)
      if (q.page !== 1) bad.push(`改筛选后 page=${JSON.stringify(q.page)}，应 1`)
      if (inst.currentTeacherName !== '曾鸣') bad.push(`选中后触发器显示 ${JSON.stringify(inst.currentTeacherName)}，应 '曾鸣'`)

      // ③ 老链接 ?owner=中文名（不是 username）也要显示中文名
      inst.query.owner = '曹冬林'
      if (inst.currentTeacherName !== '曹冬林') {
        bad.push(`?owner=中文名 时触发器显示 ${JSON.stringify(inst.currentTeacherName)}，应原样显示 '曹冬林'（不能回落成 m.Teacher）`)
      }
      inst.query.owner = ''

      // ④ 再来一遍完整的 题库→实验 往返，确认不是"第一次侥幸"：翻页也不该把名单弄丢
      await push('/question-bank')
      await settle()
      await push('/contest')
      await settle()
      const back = menuTexts()
      if (back.length !== want.length) {
        bad.push(`题库→实验切回来后菜单只有 ${back.length} 项（应 ${want.length}）：${JSON.stringify(back)}`)
      }

      cleanup()
      return {
        name: '比赛列表：任课老师从文本框改成可点选下拉菜单',
        ok: bad.length === 0,
        detail: bad.length ? '❌ ' + bad.join('；')
          : `菜单 ${got.length} 项（全部+${TEACHERS.length} 位老师）✅ / 点「曾鸣」→ owner=ZengMing、page=1 ✅` +
            ` / ?owner=中文名 不回落到占位符 ✅ / 题库页不显示 ✅ / 题库→实验切回来名单不缩水 ✅`
      }
    } catch (e) {
      cleanup()
      return {name: '比赛列表：任课老师从文本框改成可点选下拉菜单', ok: false, detail: '用例本身异常：' + e.message}
    }
  })()
}

// ── 跑 ───────────────────────────────────────────────────────────
const cases = [checkAnnouncements, checkPaletteSwitch, checkRankFrozenColumns, checkNavIconGlyphs,
               checkContestListNav, checkContestListNavBehavior, checkContestTypeIcons,
               checkThemeSwitch, checkDraftGuard, checkThemeSafeSwap, checkMonacoLazy,
               checkUnreadPollInterval, checkTeacherFilterDropdown]

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
