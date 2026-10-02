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
          <!-- 作者（任课老师）筛选：题库页不显示 —— 17 个题库全是同一位老师建的，筛了没意义 -->
          <li v-if="!isQuestionBank">
            <Input id="author" @on-enter="onFilterChange" @on-click="onFilterChange" v-model="query.owner"
                   icon="ios-search-strong" :placeholder="$t('m.Teacher')" />
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
  function withAuthor (c) {
    let cb = c.created_by || {}
    return Object.assign({}, c, {author: cb.real_name || cb.username || ''})
  }

  // 走**服务端**排序的列（= 后端 CONTEST_ORDERING_FIELDS 的键）。
  // 其余 sortable 列（「任课老师」）仍是前端当前页排序 —— 见 columns 里的注释。
  const SERVER_SORT_KEYS = ['title', 'start_time', 'end_time']

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
      },
      getContestList (page = 1) {
        this.$Loading.start()
        let offset = (page - 1) * this.limit
        api.getContestList(offset, this.limit, this.query).then((res) => {
          // 「实验 / 题库」的区分由后端 category 参数完成（见 ContestListAPI）。
          // 原来这里按标题前缀 filter('[教材]') 是死代码：全库 0 个标题带该前缀。
          this.contests = res.data.data.results.map(withAuthor)
          this.total = res.data.data.total
          this.$Loading.finish()
        }, () => {
          // 失败也要收掉进度条，否则页面永远停在"加载中"
          this.$Loading.error()
        })
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
              let children = [
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
            width: 150,
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
            width: 170,
            sortable: 'custom',
            render (h, params) {
              return h('span', time.utcToLocal(params.row.start_time, 'YYYY-M-D HH:mm'))
            }
          },
          {
            title: self.$i18n.t('m.End_Time'),
            key: 'end_time',
            width: 170,
            sortable: 'custom',
            render (h, params) {
              return h('span', time.utcToLocal(params.row.end_time, 'YYYY-M-D HH:mm'))
            }
          },
          {
            title: self.$i18n.t('m.Rule'),
            key: 'rule_type',
            width: 110,
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
            width: 120,
            align: 'center',
            render (h, params) {
              let s = CONTEST_STATUS_REVERSE[params.row.status]
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
    #author {
      width: 60%;
      margin-right: 30px;
    }
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
      }
    }
  }
</style>
