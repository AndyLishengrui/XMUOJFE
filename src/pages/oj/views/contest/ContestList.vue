<template>
  <Row type="flex">
    <Col :span="24">
    <Panel id="contest-card" shadow>
      <div slot="title">{{query.rule_type === '' ? this.$i18n.t('m.All') : query.rule_type}} {{isQuestionBank ? $t('m.Question_Bank') : $t('m.Contests')}}</div>
      <div slot="extra">
        <ul class="filter">
          <li>
            <Dropdown @on-click="onRuleChange">
              <span>{{query.rule_type === '' ? this.$i18n.t('m.Rule') : this.$i18n.t('m.' + query.rule_type)}}
                <Icon type="arrow-down-b"></Icon>
              </span>
              <Dropdown-menu slot="list">
                <Dropdown-item name="">{{$t('m.All')}}</Dropdown-item>
                <Dropdown-item name="OI">{{$t('m.OI')}}</Dropdown-item>
                <Dropdown-item name="ACM">{{$t('m.ACM')}}</Dropdown-item>
              </Dropdown-menu>
            </Dropdown>
          </li>
          <li>
            <Dropdown @on-click="onStatusChange">
              <span>{{query.status === '' ? this.$i18n.t('m.Status') : this.$i18n.t('m.' + CONTEST_STATUS_REVERSE[query.status].name.replace(/ /g,"_"))}}
                <Icon type="arrow-down-b"></Icon>
              </span>
              <Dropdown-menu slot="list">
                <Dropdown-item name="">{{$t('m.All')}}</Dropdown-item>
                <Dropdown-item name="0">{{$t('m.Underway')}}</Dropdown-item>
                <Dropdown-item name="1">{{$t('m.Not_Started')}}</Dropdown-item>
                <Dropdown-item name="-1">{{$t('m.Ended')}}</Dropdown-item>
              </Dropdown-menu>
            </Dropdown>
          </li>
          <!-- 作者（任课老师）筛选：题库页不显示 —— 17 个题库全是同一位老师建的，筛了没意义。
               2026-10-16 由**自由文本框**改成**下拉菜单**：老师反映每次都要手打名字太慢，
               改成点鼠标选。控件形态照抄上面「实验」「状态」两个 Dropdown，保持整栏一致。
               候选项来自 /api/contest_teachers（只列有可见比赛的老师 ⇒ 不会出现选了却筛不出的死选项）。 -->
          <li v-if="!isQuestionBank">
            <Dropdown @on-click="onTeacherChange">
              <span>{{ currentTeacherName }}
                <Icon type="arrow-down-b"></Icon>
              </span>
              <Dropdown-menu slot="list">
                <Dropdown-item name="">{{$t('m.All')}}</Dropdown-item>
                <Dropdown-item v-for="t in teachers" :key="t.username" :name="t.username">{{t.real_name}}</Dropdown-item>
              </Dropdown-menu>
            </Dropdown>
          </li>
          <li>
            <Input id="keyword" @on-enter="onFilterChange" @on-click="onFilterChange" v-model="query.keyword"
                   icon="ios-search-strong" :placeholder="$t('m.Keyword')" />
          </li>
        </ul>
      </div>
      <Table id="contest-table" :columns="columns" :data="contests" stripe
             @on-sort-change="handleSortChange"
             :no-data-text="$t('m.No_contest')"></Table>
    </Panel>
    <Pagination :total="total" :page-size.sync="limit" @on-change="changeRoute" :current.sync="page" :show-sizer="true" @on-page-size-change="changeRoute"></Pagination>
    </Col>
  </Row>

</template>

<script>
  import api from '@oj/api'
  import { mapGetters } from 'vuex'
  import utils from '@/utils/utils'
  import Pagination from '@/pages/oj/components/Pagination'
  import time from '@/utils/time'
  import { CONTEST_STATUS_REVERSE, CONTEST_TYPE, DEFAULT_PAGE_SIZE, parsePageSize } from '@/utils/constants'

  // ⚠️ 每页条数必须是分页器档位（30/50/100/200）里的一员，否则那个下拉框显示空白。
  //    原来是 15 —— 不在档位里，选择框一直空着（见 utils/constants.js 的注释）。
  const limit = DEFAULT_PAGE_SIZE

  // ⚠️ iView Table 的排序是 `sortMethod(a[key], b[key], type)` —— 传进来的是
  //    **row[key] 的值**，不是整行对象（见 iview/src/components/table/table.vue:657）。
  //    所以列写成 key='author' 时，行里必须真的有 author 字段，否则 a 是 undefined、
  //    sortMethod 抛 TypeError、点表头看起来「没反应」。这里把创建者姓名摊平进去。
  //
  // 🔑 2026-10-29：**在取数时一次性算好**展示用的字符串与时间戳，render 里不再调 moment。
  //    倒计时每分钟要重渲染整张表，render 里若还去 moment(...) 建对象，30 行 × 3 个时间 = 90 个
  //    对象/次，纯属浪费；摊平后 render 只做字符串拼接。
  function decorateContest (c) {
    let cb = c.created_by || {}
    return Object.assign({}, c, {
      author: cb.real_name || cb.username || '',
      startText: time.utcToLocal(c.start_time, 'YYYY-M-D HH:mm'),
      endText: time.utcToLocal(c.end_time, 'YYYY-M-D HH:mm'),
      // Date.parse 只认 ISO 8601（后端返回的正是 '2026-11-10T15:59:59Z'），
      // 比每次渲染都进 moment 便宜得多。
      startMs: Date.parse(c.start_time),
      endMs: Date.parse(c.end_time)
    })
  }

  // ── 倒计时 ─────────────────────────────────────────────────────────
  // 粒度按老师的要求：>1 天显示天；1 天之内、>1 小时显示小时；进入 1 小时显示分钟。
  // 全部用 **向下取整** —— 显示的是"至少还剩这么多"，不会出现"剩余 0 天"这种吓人的中间态。
  const MINUTE_MS = 60 * 1000
  const HOUR_MS = 60 * MINUTE_MS
  const DAY_MS = 24 * HOUR_MS

  function splitRemaining (ms) {
    if (ms < MINUTE_MS) return {unit: 'Soon', n: 0}
    if (ms < HOUR_MS) return {unit: 'Minute', n: Math.floor(ms / MINUTE_MS)}
    if (ms < DAY_MS) return {unit: 'Hour', n: Math.floor(ms / HOUR_MS)}
    return {unit: 'Day', n: Math.floor(ms / DAY_MS)}
  }

  // 走**服务端**排序的列（= 后端 CONTEST_ORDERING_FIELDS 的键）。
  // 其余 sortable 列（「任课老师」）仍是前端当前页排序 —— 见 columns 里的注释。
  const SERVER_SORT_KEYS = ['title', 'start_time', 'end_time']

  // 比赛类型 → 标题前的图标。三个都是 iView 自带 ionicons 字形，单色、颜色走 CSS
  // currentColor ⇒ 天然跟随三套主题（配色见下方 .contest-type-icon）。
  // 🔑 旧版卡片列表每个条目前面有张奖杯图，改成 iView Table 后丢了；这里按类型补回来。
  // 🔑 2026-10-21 老师两次要求后定稿：**三种类型统一用金色奖杯**（题库原来是书、
  //    实验原来是 </>），尺寸也统一放大到 22px。类名仍保留 exp/qb/exam，
  //    但既然都是奖杯金，就不必再按类型分色。
  // ⚠️ 判定优先级 题库 > 考试 > 实验：个别比赛 is_exam 与 is_question_bank 同时为真
  //    （例：474 新书配套题库），按「题库」处理。
  const TYPE_ICON = {exam: 'trophy', qb: 'trophy', exp: 'trophy'}

  function contestType (c) {
    if (c.is_question_bank) return 'qb'
    if (c.is_exam) return 'exam'
    return 'exp'
  }

  export default {
    name: 'contest-list',
    components: {
      Pagination
    },
    data () {
      return {
        page: 1,
        query: {
          status: '',
          keyword: '',
          rule_type: '',
          // 作者筛选（后端 owner 参数：匹配创建者的用户名或中文姓名）
          owner: '',
          // 由路由 meta.category 决定（实验 / 题库）：交给后端过滤，不再在客户端筛
          category: '',
          // 表头排序，形如 'start_time' / '-end_time'（空 = 后端默认序 -start_time）。
          // 放在 query 里是为了跟着其它筛选条件一起进 URL：刷新/后退/分享链接都不丢。
          ordering: ''
        },
        limit: limit,
        total: 0,
        rows: '',
        contests: [],
        // 倒计时用的"现在"。整张表**共用这一个**、每分钟走一次（见 scheduleTick）。
        nowMs: Date.now(),
        tickTimer: null,
        // 「任课老师」下拉的候选项：[{username, real_name, count}]，来自 /api/contest_teachers
        teachers: [],
        // 上面这份名单是**按哪个分类**拉的（experiment / question_bank）。
        // 见 getTeachers() 的注释：/contest 与 /question-bank 共用实例，必须按分类重拉。
        teachersCategory: null,
        CONTEST_STATUS_REVERSE: CONTEST_STATUS_REVERSE,
//      for password modal use
        cur_contest_id: ''
      }
    },
    mounted () {
      // ⚠️ 取数**不能**放在 beforeRouteEnter 里。vue-router 会等 next()，而 next() 只能写在
      //    请求回调里 ⇒ **整次跳转被一次网络往返挡住**。挡住期间：URL 不变、旧页面还盖在上面、
      //    没有任何 loading ⇒ 用户点了菜单像"卡死"。
      //    （2026-10-02 老师报的「从题目页 / 排名页切到实验就卡顿」就是它：日志里那个请求带的
      //      referer 还是**上一个页面**的地址，正好证明点击那一刻地址栏都还没变。）
      //    改成 mounted 取数 + $Loading：点击立刻跳转，表格随后填上。
      this.init()
      // 倒计时：整个列表**只用一个**定时器（不是每行一个），详见 scheduleTick。
      this.startTicker()
    },
    beforeDestroy () {
      this.stopTicker()
    },
    watch: {
      // 复用同一个实例时的刷新（/contest ↔ /question-bank 互切、翻页、筛选、排序）。
      // ⚠️ 这里**必须**用 watch，不能用 beforeRouteUpdate：`/contest` 与 `/question-bank`
      //    是**两条路由记录共用同一个组件**（routes.js 里两个 record 指向同一个 ContestList），
      //    而 vue-router 只在"同一条记录被复用"时才调 beforeRouteUpdate ⇒ 这两个页面互切时
      //    它根本不触发，列表会一直停在**上一个分类**的数据上。
      //    （2026-10-02 用真实路由跑出来的：beforeRouteUpdate 版本取数次数是 1→1→1。）
      // 🔑 代价：跨组件跳走时**即将被销毁的旧实例**也会触发这个 watcher（Vue 的用户 watcher
      //    先于 router-view 的重渲染执行）⇒ 白发一条一模一样的请求、过期响应还可能覆盖新列表。
      //    所以推迟到 nextTick 再判 —— 那时重渲染已跑完，被弹掉的实例已经 _isDestroyed。
      '$route' (to) {
        this.$nextTick(() => {
          if (this._isDestroyed || this._isBeingDestroyed) return
          this.init(to)
        })
      }
    },
    methods: {
      // 从 URL 同步筛选状态（不取数）。省略 route 时用当前路由；
      // ⚠️ watcher 里**必须**把 to 传进来 —— 那一刻 this.$route 还是旧路由。
      syncQuery (route) {
        route = route || this.$route
        const q = route.query || {}
        this.query.status = q.status || ''
        this.query.rule_type = q.rule_type || ''
        this.query.keyword = q.keyword || ''
        this.query.owner = q.owner || ''
        this.query.ordering = q.ordering || ''
        this.query.category = (route.meta || {}).category || ''
        this.page = parseInt(q.page) || 1
        this.limit = parsePageSize(q.limit)
      },
      init (route) {
        this.syncQuery(route)
        this.getContestList(this.page)
        // 放在 syncQuery **之后**：getTeachers 读的是 this.query.category。
        // 分类没变时它内部会直接 return，不会白发请求。
        this.getTeachers()
      },
      getContestList (page = 1) {
        this.$Loading.start()
        let offset = (page - 1) * this.limit
        api.getContestList(offset, this.limit, this.query).then((res) => {
          // 「实验 / 题库」的区分由后端 category 参数完成（见 ContestListAPI）。
          // 原来这里按标题前缀 filter('[教材]') 是死代码：全库 0 个标题带该前缀。
          // 取数回来时顺手对一次表：倒计时最多只差"取数这一刻"的几十毫秒，
          // 而不是等下一次整分钟 tick 才第一次显示（否则新页面可能一上来就少一分钟）。
          this.nowMs = Date.now()
          this.contests = res.data.data.results.map(decorateContest)
          this.total = res.data.data.total
          this.$Loading.finish()
        }, () => {
          // 失败也要收掉进度条，否则页面永远停在"加载中"
          this.$Loading.error()
        })
      },
      // ── 倒计时刷新 ────────────────────────────────────────────────
      // 🔑 性能要点（老师要求「让系统不卡」）：
      //   1. **一个列表只有一个定时器**。绝不给每一行挂 setInterval —— 30 行就是 30 个
      //      定时器 + 30 次独立渲染，翻页/销毁时还容易漏清理。
      //   2. 定时器**对齐到下一个整分钟**，而不是 setInterval(…, 60000)。
      //      setInterval 会和"整分钟"越走越偏：比如 12:00:30 启动，之后每小时都在 :30 跳，
      //      "剩余 60 分钟" 会在还剩 59:30 时就变成 59 分钟。对齐后跳变点与真实剩余量一致。
      //   3. 标签页在后台时**直接停表**（visibilitychange 回来后补一次），
      //      后台标签页本来就不会被看到，没必要耗电/占主线程。
      //   4. 刷新时只把 data 数组换一个引用（iView Table 靠它触发重渲染），
      //      不重新取数、不重新算 moment —— 30 行的重渲染是毫秒级。
      startTicker () {
        this.stopTicker()
        document.addEventListener('visibilitychange', this.handleVisibilityChange)
        this.scheduleTick()
      },
      stopTicker () {
        if (this.tickTimer) {
          clearTimeout(this.tickTimer)
          this.tickTimer = null
        }
        document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      },
      handleVisibilityChange () {
        if (document.hidden) {
          // 后台：停表。回来时由下面的 else 分支重新对表 + 立即刷新一次。
          if (this.tickTimer) {
            clearTimeout(this.tickTimer)
            this.tickTimer = null
          }
        } else {
          this.refreshCountdown()
          this.scheduleTick()
        }
      },
      scheduleTick () {
        if (this.tickTimer) clearTimeout(this.tickTimer)
        // +100ms 缓冲：定时器可能早触发几百微秒，卡在 59:59.999 会少算一分钟
        const delay = MINUTE_MS - (Date.now() % MINUTE_MS) + 100
        this.tickTimer = setTimeout(() => {
          this.tickTimer = null
          if (document.hidden) return // 后台的这拍丢掉，回来时 visibilitychange 会补
          this.refreshCountdown()
          this.scheduleTick()
        }, delay)
      },
      refreshCountdown () {
        this.nowMs = Date.now()
        // ⚠️ iView Table 监听的是 data 的**引用**；原地改 nowMs 不会让格子重渲染。
        //    slice() 换引用即可，行对象本身复用（不丢任何状态，也不重新建 moment）。
        if (this.contests.length) this.contests = this.contests.slice()
      },
      // 某一场比赛的倒计时。三态分别取自 startMs / endMs：
      //   未开始 → 距开始；进行中 → 距截止；已结束 → 「已结束」。
      countdownOf (row) {
        const now = this.nowMs
        if (now < row.startMs) {
          const r = splitRemaining(row.startMs - now)
          return {
            text: r.unit === 'Soon'
              ? this.$t('m.Starts_Soon')
              : this.$t('m.Starts_In_' + r.unit, {n: r.n}),
            level: 'is-upcoming',
            icon: 'ios-time-outline'
          }
        }
        if (now >= row.endMs) {
          return {text: this.$t('m.Ended'), level: 'is-ended', icon: ''}
        }
        const r = splitRemaining(row.endMs - now)
        // 颜色分级：>1 天（灰）→ ≤1 天（橙）→ ≤1 小时（红）→ 不足 1 分钟（红）。
        const level = r.unit === 'Day' ? 'is-safe'
          : (r.unit === 'Hour' ? 'is-warning' : 'is-danger')
        return {
          text: r.unit === 'Soon'
            ? this.$t('m.Remaining_Soon')
            : this.$t('m.Remaining_' + r.unit, {n: r.n}),
          level,
          icon: r.unit === 'Day' ? 'ios-time-outline' : 'ios-alarm-outline'
        }
      },
      // 状态也用本地时间现算，而不是沿用取数那一刻的 row.status：
      // 页面开着不动、比赛到点结束后，状态徽章和倒计时会一起变，不会出现
      // 「倒计时已结束、状态还是进行中」这种自相矛盾的画面。
      statusOf (row) {
        if (this.nowMs < row.startMs) return '1'
        if (this.nowMs >= row.endMs) return '-1'
        return '0'
      },
      changeRoute () {
        let query = Object.assign({}, this.query)
        query.page = this.page
        query.limit = this.limit
        // category 由路由 meta 决定，不进 URL —— 避免出现两个真相来源
        delete query.category

        this.$router.push({
          // 用当前路由名，否则在 /question-bank 上改筛选会被弹回 /contest
          name: this.$route.name,
          query: utils.filterEmptyValue(query)
        })
      },
      // 改筛选条件时必须回到第 1 页：否则在第 2 页输入关键字/作者会停在空的第 2 页。
      // 分页器自己调 changeRoute，不能在这里统一重置 page。
      onFilterChange () {
        this.page = 1
        this.changeRoute()
      },
      // 「任课老师」下拉取候选项。由 init() 调用（= 挂载时 + 每次路由变化时），
      // 但**只在分类真的变了才发请求** —— 翻页 / 改筛选 / 改排序都是 no-op。
      //
      // ⚠️ 2026-10-16 修的一个真 bug：原来只在 mounted 里取一次，而 `/contest` 与
      //    `/question-bank` 是**两条路由记录共用同一个组件实例**（见上面 watch 的注释），
      //    互切时 mounted **不会重跑** ⇒ 从题库切回实验页后，下拉用的还是**题库那份名单**
      //    （题库只有 1 位老师）⇒ 老师实测「只剩下李胜睿老师了」，整页刷新才恢复。
      //    所以必须跟着分类走：按 category 记一份"已拉过哪个分类"，变了才重拉。
      getTeachers () {
        let category = this.query.category
        if (category === this.teachersCategory) return
        this.teachersCategory = category
        api.getContestTeachers({category}).then((res) => {
          this.teachers = res.data.data || []
        }, () => {
          // 取不到就只是个空下拉，不影响列表本身 —— 不弹错、不阻塞页面。
          // ⚠️ 失败时要把 marks 清掉，否则会把"空名单"当成"这个分类已拉过"，永不重试。
          this.teachers = []
          this.teachersCategory = null
        })
      },
      onTeacherChange (username) {
        this.query.owner = username
        this.page = 1
        this.changeRoute()
      },
      onRuleChange (rule) {
        this.query.rule_type = rule
        this.page = 1
        this.changeRoute()
      },
      onStatusChange (status) {
        this.query.status = status
        this.page = 1
        this.changeRoute()
      },
      // 表头点击排序：改写 ordering → 进 URL → $route 变化触发 init() 重新取数。
      // iView 给的 order 是 'asc' | 'desc' | 'normal'（第三次点同一列 = normal = 取消，
      // 回到后端默认序 -start_time）。
      // ⚠️ iView 对**所有** sortable 列都发这个事件（table.vue 的 handleSort 无条件 emit），
      //    包括前端排序的「任课老师」列 —— 那一列必须在这里直接放过去，否则会被清掉。
      handleSortChange ({ key, order }) {
        if (SERVER_SORT_KEYS.indexOf(key) === -1) return
        this.query.ordering = order === 'normal' ? '' : (order === 'desc' ? '-' : '') + key
        this.page = 1
        this.changeRoute()
      },
      goContest (contest) {
        this.cur_contest_id = contest.id
        if (contest.contest_type !== CONTEST_TYPE.PUBLIC && !this.isAuthenticated) {
          this.$error(this.$i18n.t('m.Please_login_first'))
          this.$store.dispatch('changeModalStatus', {visible: true})
        } else {
          this.$router.push({name: 'contest-details', params: {contestID: contest.id}})
        }
      },

      getDuration (startTime, endTime) {
        return time.duration(startTime, endTime)
      }
    },
    computed: {
      ...mapGetters(['isAuthenticated', 'user']),

      isQuestionBank () {
        return this.query.category === 'question_bank'
      },

      // 下拉触发器上显示的当前老师名。
      // ⚠️ 匹配不上时**原样显示 query.owner**，不要回落到「任课老师」：
      //    老链接可能是 `?owner=曾鸣`（中文名，2026-09-22 那版就是这么分享的），
      //    中文名不是候选项的 value（value 是 username），但它**确实在生效**
      //    （后端 ContestListAPI 的 owner 对 username/real_name 都做 icontains）。
      //    若这里显示成空的「任课老师」，老师会以为筛选没生效。
      currentTeacherName () {
        let t = this.teachers.find(item => item.username === this.query.owner)
        return (t && t.real_name) || this.query.owner || this.$i18n.t('m.Teacher')
      },

      columns () {
        let self = this
        let cols = [
          {
            title: self.$i18n.t('m.Title'),
            key: 'title',
            minWidth: 280,
            // 'custom' = 不做本地排序，只发 on-sort-change 让服务端重排（见 handleSortChange）。
            // 用 'custom' 而不是 true 的原因：列表是**服务端分页**的，本地排序只作用于当前页。
            sortable: 'custom',
            render (h, params) {
              let row = params.row
              let type = contestType(row)
              let children = [
                // 类型图标放在标题**前面**（旧版那个奖杯的位置）
                h('Icon', {
                  class: 'contest-type-icon ' + type,
                  props: {type: TYPE_ICON[type]}
                }),
                h('a', {
                  class: 'entry',
                  on: {
                    click: (e) => {
                      e.stopPropagation()
                      self.goContest(row)
                    }
                  }
                }, row.title)
              ]
              if (row.contest_type !== CONTEST_TYPE.PUBLIC) {
                children.push(h('Icon', {props: {type: 'ios-locked-outline'}}))
              }
              return h('div', {class: 'contest-title'}, children)
            }
          }
        ]

        // 题库页不显示「任课老师」列（17 个题库全是同一位老师建的）
        if (!self.isQuestionBank) {
          cols.push({
            title: self.$i18n.t('m.Teacher'),
            key: 'author',
            width: 130,
            // ⚠️ 这一列**故意**保持前端排序（只作用于当前页）——和上面三列不一样。
            //    原因：`localeCompare(..., 'zh-Hans-CN')` 按**拼音**排，而数据库
            //    ORDER BY 是按 Unicode 码位排（曾 U+66FE < 李 U+674E，但拼音是 李 < 曾），
            //    改成服务端排序会让老师看到"排错了"。列表一页放得下（实验 25 条），
            //    所以当前页排序实际等于全量排序。要改需后端加拼音排序，另议。
            sortable: true,
            // a/b 是 row.author 的值（见文件顶部 withAuthor 的注释），不是整行
            sortMethod: (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN'),
            render (h, params) {
              return h('span', params.row.author || '-')
            }
          })
        }

        cols.push(
          {
            title: self.$i18n.t('m.Start_Time'),
            key: 'start_time',
            width: 160,
            sortable: 'custom',
            // 展示字符串在 decorateContest 里算好，render 里不再进 moment（见文件上方注释）。
            render (h, params) {
              return h('span', params.row.startText)
            }
          },
          {
            title: self.$i18n.t('m.End_Time'),
            key: 'end_time',
            width: 160,
            sortable: 'custom',
            render (h, params) {
              return h('span', params.row.endText)
            }
          },
          {
            // 2026-10-29 老师要求：一眼看出还剩多少时间。
            // 显示粒度 = 天 / 小时 / 分钟三档（见 splitRemaining），最后 1 小时标红。
            title: self.$i18n.t('m.Time_Remaining'),
            key: 'remaining',
            width: 150,
            align: 'center',
            render (h, params) {
              let c = self.countdownOf(params.row)
              let children = []
              if (c.icon) children.push(h('Icon', {props: {type: c.icon}}))
              children.push(h('span', {class: 'countdown-text'}, c.text))
              return h('span', {class: ['countdown', c.level]}, children)
            }
          },
          {
            title: self.$i18n.t('m.Rule'),
            key: 'rule_type',
            width: 100,
            align: 'center',
            render (h, params) {
              return h('Button', {
                props: {size: 'small', shape: 'circle'},
                on: {
                  click: () => self.onRuleChange(params.row.rule_type)
                }
              }, params.row.rule_type)
            }
          },
          {
            title: self.$i18n.t('m.Status'),
            key: 'status',
            // ⚠️ 别低于 130：2026-10-29 压到 110 时，老师的页面上「进行中」被截成「进行」、
            //    「已结束」截成「已结」（iView 单元格 overflow: hidden）。状态是三个汉字 + 圆点，
            //    留 130 才有余量。
            width: 130,
            align: 'center',
            render (h, params) {
              // 用本地现算的状态（statusOf），比赛到点结束后不用刷新页面也会变「已结束」
              let s = CONTEST_STATUS_REVERSE[self.statusOf(params.row)]
              return h('Tag', {props: {type: 'dot', color: s.color}},
                self.$i18n.t('m.' + s.name.replace(/ /g, '_')))
            }
          }
        )
        return cols
      }
    }
  }
</script>
<style lang="less" scoped>
  #contest-card {
    // 注：原来这里有一条 `#author { width: 60%; margin-right: 30px; }` —— 那是给
    // 自由文本框用的。2026-10-16 换成 Dropdown 后它已无用（Dropdown 的排版与
    // 上面「实验」「状态」两个筛选完全一致，由共享的 components/Panel.vue 的
    // `ul.filter > li { display:inline-block; padding:0 10px }` 提供）。
    #keyword {
      width: 80%;
      margin-right: 30px;
    }
    // 老师反馈「字体太小、不明显」：iView 表格默认是 @font-size-small(12px)，
    // 而且原来还带 size="small" 把行压得更小 —— 这里显式提高字号与行高。
    #contest-table {
      /deep/ .ivu-table-cell {
        padding-left: 12px;
        padding-right: 12px;
        font-size: 15px;
      }
      /deep/ .ivu-table td {
        height: 56px;
      }
      /deep/ .ivu-table-header .ivu-table-cell {
        font-size: 14px;
        font-weight: 600;
      }
      // ── 「剩余时间」列 ──────────────────────────────────────────────
      // 胶囊底色提醒紧迫度：灰 = 还早（>1 天）、橙 = 1 天内、红 = 1 小时内。
      // 颜色全部走主题 token，暗色主题下自动跟着变（别写死 #fff/#f00）。
      /deep/ .countdown {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 10px;
        border-radius: 11px;
        font-size: 13px;
        font-weight: 600;
        line-height: 20px;
        white-space: nowrap;
        .ivu-icon {
          font-size: 14px;
        }
      }
      /deep/ .countdown.is-safe {
        color: var(--c-text-2);
        background: var(--c-bg-soft);
      }
      // 时钟图标单独上色（2026-10-29 老师：「图标都是灰的，不显眼」）。
      // 文字保持原语义色不变，**只让图标跟紧迫度走**：
      //   宽裕(>1 天)=绿 / 未开始=蓝 / 临期(≤1 天)=橙 / 紧急(≤1 小时)=红。
      // 「还早」这档文字是灰的，图标若也跟着灰，整列就没重点 ⇒ 给它绿色。
      /deep/ .countdown.is-safe .ivu-icon {
        color: var(--c-success);
      }
      /deep/ .countdown.is-upcoming {
        color: var(--c-brand);
        background: var(--c-brand-tint);
      }
      /deep/ .countdown.is-warning {
        color: var(--c-warning);
        background: var(--c-warning-tint);
      }
      /deep/ .countdown.is-danger {
        color: var(--c-error);
        background: var(--c-error-tint);
      }
      /deep/ .countdown.is-ended {
        padding: 0;
        color: var(--c-text-3);
        background: transparent;
        font-weight: 400;
      }
      /deep/ .contest-title {
        .entry {
          font-size: 16px;
          font-weight: 500;
          color: var(--c-text-2);
          &:hover {
            color: var(--c-brand);
            border-bottom: 1px solid var(--c-brand);
          }
        }
        .ivu-icon {
          margin-left: 6px;
          vertical-align: middle;
        }
        // 标题前的类型图标。⚠️ 必须排在 .ivu-icon 之后：两者特异性相同（都是两段类名），
        //    靠源码顺序覆盖掉 .ivu-icon 的 margin-left，把间距放到右侧（图标在标题左边）。
        .contest-type-icon {
          margin-left: 0;
          margin-right: 10px;
          // 2026-10-21 老师要求「大一点、更好看」：18px → 22px（行高 56px，仍居中）
          font-size: 22px;
          vertical-align: middle;
          // 三种类型统一金色奖杯（原先考试/题库=金、实验=橙）。
          // 用主题自带的 --c-gold，三套主题下自动跟着变。
          color: var(--c-gold);
        }
      }
    }
  }
</style>
