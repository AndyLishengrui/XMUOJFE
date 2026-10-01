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
          category: ''
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
    beforeRouteEnter (to, from, next) {
      // ⚠️ 首次进入只走 beforeRouteEnter（$route 的 watch 不会为初次导航触发），
      //    所以这里必须带上 URL 上的**全部**筛选条件 —— 否则直接打开
      //    /contest?owner=曾鸣 这类链接会显示未筛选结果、筛选框也是空的。
      let page = parseInt(to.query.page) || 1
      let size = parsePageSize(to.query.limit)
      let q = Object.assign({}, to.query, {category: to.meta.category})
      delete q.page
      delete q.limit
      api.getContestList((page - 1) * size, size, q).then((res) => {
        next((vm) => {
          vm.contests = res.data.data.results.map(withAuthor)
          vm.total = res.data.data.total
        })
      }, (res) => {
        next()
      })
    },
    mounted () {
      // 首屏的取数在 beforeRouteEnter 里已经做过了，这里只把筛选框/分页按 URL 回填，
      // 避免重复请求（原来没有这一步，所以带筛选的链接打开后输入框是空的）。
      this.syncQuery()
    },
    methods: {
      // 从 URL 同步筛选状态（不取数）
      syncQuery () {
        let route = this.$route.query
        this.query.status = route.status || ''
        this.query.rule_type = route.rule_type || ''
        this.query.keyword = route.keyword || ''
        this.query.owner = route.owner || ''
        this.query.category = this.$route.meta.category || ''
        this.page = parseInt(route.page) || 1
        this.limit = parsePageSize(route.limit)
      },
      init () {
        this.syncQuery()
        this.getContestList(this.page)
      },
      getContestList (page = 1) {
        let offset = (page - 1) * this.limit
        api.getContestList(offset, this.limit, this.query).then((res) => {
          // 「实验 / 题库」的区分由后端 category 参数完成（见 ContestListAPI）。
          // 原来这里按标题前缀 filter('[教材]') 是死代码：全库 0 个标题带该前缀。
          this.contests = res.data.data.results.map(withAuthor)
          this.total = res.data.data.total
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
            sortable: true,
            // a/b 是 row.author 的值（见文件顶部 withAuthor 的注释），不是整行
            // ⚠️ 服务端分页，排序只作用于「当前页」
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
            render (h, params) {
              return h('span', time.utcToLocal(params.row.start_time, 'YYYY-M-D HH:mm'))
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
    },
    watch: {
      '$route' (newVal, oldVal) {
        if (newVal !== oldVal) {
          this.init()
        }
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
