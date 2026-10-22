<template>
  <div class="view">
    <Panel>
      <template slot="title">
        Contest List
        <span v-if="total" class="total-count">（{{ total }}）</span>
      </template>

      <!-- 工具栏放在 body 里，不放 slot="header"：那里是绝对定位，控件一多会压住标题。 -->
      <div class="list-toolbar">
        <el-input
          v-model="query.keyword"
          prefix-icon="el-icon-search"
          placeholder="Search title"
          clearable
          class="toolbar-keyword"
          @input="scheduleKeywordSearch"
          @keyup.enter.native="applyKeywordNow"
          @clear="applyKeywordNow">
        </el-input>
        <el-select
          v-model="query.owner"
          filterable
          clearable
          placeholder="All owners"
          class="toolbar-owner"
          @change="onFilterChange">
          <el-option
            v-for="t in ownerOptions"
            :key="t.username"
            :label="t.label"
            :value="t.username">
          </el-option>
        </el-select>
        <el-select
          v-model="query.status"
          clearable
          placeholder="All statuses"
          class="toolbar-status"
          @change="onFilterChange">
          <el-option label="Underway" value="0"></el-option>
          <el-option label="Not Started" value="1"></el-option>
          <el-option label="Ended" value="-1"></el-option>
        </el-select>
        <el-select
          v-model="query.rule_type"
          clearable
          placeholder="All rules"
          class="toolbar-rule"
          @change="onFilterChange">
          <el-option label="OI" value="OI"></el-option>
          <el-option label="ACM" value="ACM"></el-option>
        </el-select>
        <el-button icon="el-icon-refresh" @click="resetFilters">Reset</el-button>
      </div>

      <el-table
        v-loading="loading"
        element-loading-text="loading"
        ref="table"
        :data="contestList"
        size="small"
        style="width: 100%"
        @sort-change="handleSortChange"
        @row-dblclick="onRowDblclick">
        <el-table-column
          prop="id"
          width="56"
          label="ID"
          sortable="custom">
        </el-table-column>
        <el-table-column
          prop="title"
          min-width="300"
          label="Title"
          show-overflow-tooltip
          sortable="custom">
        </el-table-column>
        <el-table-column
          prop="owner"
          label="Owner"
          width="110"
          sortable="custom">
          <template slot-scope="scope">
            <el-tooltip :content="scope.row.created_by.username" placement="top">
              <span class="owner-name">{{ ownerName(scope.row) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column
          label="Type"
          width="112">
          <template slot-scope="scope">
            <el-tag size="mini" type="info">{{ scope.row.rule_type }}</el-tag>
            <el-tooltip :content="scope.row.contest_type" placement="top">
              <el-tag
                size="mini"
                class="type-tag"
                :type="scope.row.contest_type === 'Public' ? 'success' : 'warning'">
                {{ scope.row.contest_type === 'Public' ? 'Public' : 'Pwd' }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column
          label="Status"
          width="92">
          <template slot-scope="scope">
            <el-tag size="mini" :type="statusTagType(scope.row.status)">
              {{ statusName(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="Time"
          width="172">
          <!-- 单列无法同时挂三个原生排序键：用表头下拉覆盖 开始/结束/创建 时间。 -->
          <template slot="header">
            <el-dropdown trigger="click" @command="handleTimeSort">
              <span class="time-sort-trigger">
                Time
                <i v-if="timeSortIcon" :class="timeSortIcon"></i>
                <i class="el-icon-arrow-down"></i>
              </span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="start_time">Start earliest</el-dropdown-item>
                <el-dropdown-item command="-start_time">Start latest</el-dropdown-item>
                <el-dropdown-item command="end_time" divided>End earliest</el-dropdown-item>
                <el-dropdown-item command="-end_time">End latest</el-dropdown-item>
                <el-dropdown-item command="create_time" divided>Created oldest</el-dropdown-item>
                <el-dropdown-item command="-create_time">Created newest</el-dropdown-item>
                <el-dropdown-item command="" divided>Clear time sort</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
          </template>
          <template slot-scope="scope">
            <el-tooltip placement="top">
              <div slot="content">
                Start: {{ scope.row.start_time | localtime }}<br>
                End: {{ scope.row.end_time | localtime }}<br>
                Created: {{ scope.row.create_time | localtime }}
              </div>
              <span class="time-range">
                {{ shortTime(scope.row.start_time) }} → {{ shortTime(scope.row.end_time) }}
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column
          width="64"
          label="Visible">
          <template slot-scope="scope">
            <el-switch
              v-model="scope.row.visible"
              active-text=""
              inactive-text=""
              @change="handleVisibleSwitch(scope.row)">
            </el-switch>
          </template>
        </el-table-column>
        <el-table-column
          fixed="right"
          width="190"
          label="Actions">
          <div slot-scope="scope" class="action-cell">
            <icon-btn name="Edit" icon="edit" @click.native="goEdit(scope.row.id)"></icon-btn>
            <icon-btn name="Problem" icon="list-ol" @click.native="goContestProblemList(scope.row.id)"></icon-btn>
            <icon-btn name="Announcement" icon="info-circle"
                      @click.native="goContestAnnouncement(scope.row.id)"></icon-btn>
            <icon-btn icon="download" name="Download Accepted Submissions"
                      @click.native="openDownloadOptions(scope.row.id, 1)"></icon-btn>
            <icon-btn icon="download" name="Download All Submissions"
                      @click.native="openDownloadOptions(scope.row.id, 0)"></icon-btn>
            <icon-btn icon="trash" name="Delete"
                      @click.native="deleteContest(scope.row)"></icon-btn>
          </div>
        </el-table-column>
      </el-table>
      <div class="panel-options">
        <el-pagination
          class="page"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="currentChange"
          @size-change="handlePageSizeChange"
          :current-page="currentPage"
          :page-size="pageSize"
          :page-sizes="pageSizes"
          :total="total">
        </el-pagination>
      </div>
    </Panel>
    <el-dialog title="Download Contest Submissions"
               width="30%"
               :visible.sync="downloadDialogVisible">
      <el-switch v-model="excludeAdmin" active-text="Exclude admin submissions"></el-switch>
      <span slot="footer" class="dialog-footer">
        <el-button type="primary" @click="downloadSubmissions">确 定</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
  import api from '../../api.js'
  import utils from '@/utils/utils'
  import time from '@/utils/time'
  import {CONTEST_STATUS_REVERSE} from '@/utils/constants'

  const PAGE_SIZES = [10, 15, 30, 50, 100, 200]
  const DEFAULT_PAGE_SIZE = 15
  const STATUS_VALUES = ['-1', '0', '1']
  const RULE_TYPES = ['OI', 'ACM']
  // 与后端 ADMIN_CONTEST_ORDERING_FIELDS 对应的白名单（键 == URL 里的 ordering）
  const ORDERING_RE = /^-?(id|title|owner|start_time|end_time|create_time)$/
  // 这三个用 Element UI 原生表头箭头；时间类走「Time」表头下拉。
  const NATIVE_SORT_PROPS = ['id', 'title', 'owner']

  export default {
    name: 'ContestList',
    data () {
      return {
        pageSize: DEFAULT_PAGE_SIZE,
        pageSizes: PAGE_SIZES,
        total: 0,
        contestList: [],
        // 统一放在 query 里，URL 同步 / 请求参数 / 排序都只认这一份状态
        query: {
          keyword: '',
          owner: '',
          status: '',
          rule_type: '',
          ordering: ''
        },
        teachers: [],
        loading: false,
        excludeAdmin: true,
        currentPage: 1,
        currentId: 1,
        dlType: 0,
        downloadDialogVisible: false,
        // 从 URL 恢复表头排序箭头时，暂时屏蔽 sort-change（table.sort() 会再触发一次）
        restoringSort: false,
        // 丢掉过期的列表响应（快速输入关键词时后发先至）
        requestSeq: 0,
        keywordTimer: null
      }
    },
    computed: {
      ownerOptions () {
        let opts = this.teachers.map(t => ({
          username: t.username,
          label: (t.real_name || t.username) + (t.count ? ` (${t.count})` : '')
        }))
        // 老链接可能带一个不在候选里的 owner（例如中文名）：保留它，别让筛选框看起来失效。
        if (this.query.owner && !opts.some(o => o.username === this.query.owner)) {
          opts.unshift({username: this.query.owner, label: this.query.owner})
        }
        return opts
      },
      timeSortIcon () {
        let ordering = this.query.ordering || ''
        if (!/^-?(start_time|end_time|create_time)$/.test(ordering)) {
          return ''
        }
        return ordering.charAt(0) === '-' ? 'el-icon-sort-down' : 'el-icon-sort-up'
      }
    },
    mounted () {
      this.applyRouteState(this.$route)
      this.getTeachers()
      this.getContestList(this.currentPage, false)
      this.restoreSortIndicator()
    },
    beforeDestroy () {
      this.cancelKeywordTimer()
    },
    methods: {
      // ── URL 状态 ────────────────────────────────────────────────
      applyRouteState (route) {
        const q = route.query || {}
        const parsedPage = parseInt(q.page, 10)
        const parsedPageSize = parseInt(q.page_size, 10)

        this.query.keyword = q.keyword || ''
        this.query.owner = q.owner || ''
        this.query.status = STATUS_VALUES.indexOf(q.status) !== -1 ? q.status : ''
        this.query.rule_type = RULE_TYPES.indexOf(q.rule_type) !== -1 ? q.rule_type : ''
        this.query.ordering = ORDERING_RE.test(q.ordering || '') ? q.ordering : ''
        this.currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        this.pageSize = PAGE_SIZES.indexOf(parsedPageSize) !== -1 ? parsedPageSize : DEFAULT_PAGE_SIZE
      },
      syncRouteQuery () {
        const query = {}
        if (this.query.keyword) query.keyword = this.query.keyword
        if (this.query.owner) query.owner = this.query.owner
        if (this.query.status) query.status = this.query.status
        if (this.query.rule_type) query.rule_type = this.query.rule_type
        if (this.query.ordering) query.ordering = this.query.ordering
        if (this.currentPage > 1) query.page = String(this.currentPage)
        if (this.pageSize !== DEFAULT_PAGE_SIZE) query.page_size = String(this.pageSize)

        const currentQuery = this.$route.query || {}
        const sameKeys = Object.keys(query).length === Object.keys(currentQuery).length
        const sameValues = Object.keys(query).every(k => currentQuery[k] === query[k])
        if (sameKeys && sameValues) {
          return
        }
        // ⚠️ vue-router 3.0.1 的 replace() **不返回 Promise**（3.1 才加），
        //    直接 `.catch()` 会抛 "Cannot read properties of undefined"。先判空再吞掉。
        const navigation = this.$router.replace({
          name: this.$route.name,
          params: this.$route.params,
          query
        })
        if (navigation && typeof navigation.catch === 'function') {
          navigation.catch(() => {})
        }
      },

      // ── 取数 ───────────────────────────────────────────────────
      getContestList (page, syncRoute = false) {
        this.currentPage = page
        if (syncRoute) {
          this.syncRouteQuery()
        }
        const seq = ++this.requestSeq
        this.loading = true
        api.getContestList((page - 1) * this.pageSize, this.pageSize, this.query).then(res => {
          if (seq !== this.requestSeq) return
          this.loading = false
          const data = (res.data && res.data.data) || {}
          this.total = data.total || 0
          this.contestList = data.results || []
          // 筛选/删除后当前页越界：退回最后一页，并让路由 watcher 重新取数。
          if (!this.contestList.length && this.total > 0 && page > 1) {
            const lastPage = Math.ceil(this.total / this.pageSize)
            if (lastPage < page) {
              this.currentPage = lastPage
              this.syncRouteQuery()
            }
          }
        }, () => {
          if (seq === this.requestSeq) {
            this.loading = false
          }
        })
      },
      getTeachers () {
        api.getContestTeachers().then(res => {
          this.teachers = (res.data && res.data.data) || []
        }, () => {
          // 取不到就只是一个空下拉，不影响列表本身
          this.teachers = []
        })
      },

      // ── 筛选 ───────────────────────────────────────────────────
      scheduleKeywordSearch () {
        this.cancelKeywordTimer()
        this.keywordTimer = setTimeout(() => {
          this.keywordTimer = null
          this.onFilterChange()
        }, 300)
      },
      applyKeywordNow () {
        this.cancelKeywordTimer()
        this.onFilterChange()
      },
      cancelKeywordTimer () {
        if (this.keywordTimer) {
          clearTimeout(this.keywordTimer)
          this.keywordTimer = null
        }
      },
      onFilterChange () {
        this.currentPage = 1
        this.syncRouteQuery()
      },
      resetFilters () {
        this.cancelKeywordTimer()
        this.query.keyword = ''
        this.query.owner = ''
        this.query.status = ''
        this.query.rule_type = ''
        this.query.ordering = ''
        this.currentPage = 1
        this.clearNativeSort()
        this.syncRouteQuery()
      },

      // ── 排序（全部走服务端） ────────────────────────────────────
      handleSortChange ({prop, order}) {
        if (this.restoringSort) return
        if (NATIVE_SORT_PROPS.indexOf(prop) === -1) return
        this.query.ordering = order ? ((order === 'descending' ? '-' : '') + prop) : ''
        this.currentPage = 1
        this.syncRouteQuery()
      },
      handleTimeSort (ordering) {
        this.query.ordering = ordering || ''
        this.currentPage = 1
        this.clearNativeSort()
        this.syncRouteQuery()
      },
      clearNativeSort () {
        const table = this.$refs.table
        if (table && table.clearSort) {
          table.clearSort()
        }
      },
      restoreSortIndicator () {
        this.$nextTick(() => {
          const table = this.$refs.table
          if (!table) return
          const ordering = this.query.ordering || ''
          const prop = ordering.replace(/^-/, '')
          if (NATIVE_SORT_PROPS.indexOf(prop) !== -1) {
            this.restoringSort = true
            table.sort(prop, ordering.charAt(0) === '-' ? 'descending' : 'ascending')
            this.$nextTick(() => {
              this.restoringSort = false
            })
          } else if (table.clearSort) {
            table.clearSort()
          }
        })
      },

      // ── 分页 ───────────────────────────────────────────────────
      currentChange (page) {
        this.currentPage = page
        this.syncRouteQuery()
      },
      handlePageSizeChange (pageSize) {
        this.pageSize = pageSize
        this.currentPage = 1
        this.syncRouteQuery()
      },

      // ── 展示辅助 ───────────────────────────────────────────────
      ownerName (row) {
        const creator = row.created_by || {}
        return creator.real_name || creator.username || ''
      },
      statusName (value) {
        const status = CONTEST_STATUS_REVERSE[value]
        return status ? status.name : value
      },
      statusTagType (value) {
        return value === '-1' ? 'danger' : value === '0' ? 'success' : ''
      },
      shortTime (value) {
        return value ? time.utcToLocal(value, 'MM-DD HH:mm') : ''
      },
      onRowDblclick (row) {
        this.goEdit(row.id)
      },

      // ── 操作 ───────────────────────────────────────────────────
      openDownloadOptions (contestId, dlType) {
        this.downloadDialogVisible = true
        this.currentId = contestId
        this.dlType = dlType
      },
      downloadSubmissions () {
        let excludeAdmin = this.excludeAdmin ? '1' : '0'
        let url = `/admin/download_submissions?contest_id=${this.currentId}&exclude_admin=${excludeAdmin}&dlType=${this.dlType}`
        utils.downloadFile(url)
      },
      goEdit (contestId) {
        this.$router.push({name: 'edit-contest', params: {contestId}})
      },
      goContestAnnouncement (contestId) {
        this.$router.push({name: 'contest-announcement', params: {contestId}})
      },
      goContestProblemList (contestId) {
        this.$router.push({name: 'contest-problem-list', params: {contestId}})
      },
      deleteContest (row) {
        this.$confirm(
          'Hard delete will permanently remove this contest and related data (submissions/ranks). Continue?',
          'Warning',
          {
            type: 'warning'
          }
        ).then(() => {
          this.loading = true
          api.deleteContest(row.id, true).then(() => {
            this.loading = false
            this.$success('Contest deleted successfully')
            this.getTeachers()
            // 删掉当前页最后一行时退一页
            const prevPage = this.currentPage
            const nextPage = (this.contestList.length === 1 && prevPage > 1) ? prevPage - 1 : prevPage
            this.currentPage = nextPage
            if (nextPage !== prevPage) {
              this.syncRouteQuery()
            } else {
              this.getContestList(nextPage, false)
            }
          }).catch((err) => {
            const message = err && err.data && err.data.data
              ? err.data.data
              : 'Delete failed. Please check owner permission or contest status and try again.'
            this.$error(message)
          }).finally(() => {
            this.loading = false
          })
        }).catch(() => {})
      },
      handleVisibleSwitch (row) {
        api.editContest(row).then(() => {
          this.$success('')
        }, () => {
          row.visible = !row.visible
          this.$error('Failed to update visibility')
        })
      }
    },
    watch: {
      // 路由是筛选/排序/分页的唯一真相：控件只改 query + replace 路由，统一在这里取数。
      '$route' (newVal) {
        this.cancelKeywordTimer()
        this.applyRouteState(newVal)
        this.getContestList(this.currentPage, false)
        this.restoreSortIndicator()
      }
    }
  }
</script>

<style lang="less" scoped>
  .total-count {
    font-size: 13px;
    font-weight: normal;
    color: #909399;
    margin-left: 4px;
  }

  .list-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;

    .toolbar-keyword { width: 240px; }
    .toolbar-owner { width: 180px; }
    .toolbar-status { width: 140px; }
    .toolbar-rule { width: 120px; }
  }

  .owner-name {
    display: inline-block;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }

  .type-tag {
    margin-left: 4px;
  }

  .time-range {
    font-size: 12px;
    color: #606266;
    white-space: nowrap;
  }

  .time-sort-trigger {
    cursor: pointer;
    user-select: none;

    .el-icon-sort-up,
    .el-icon-sort-down {
      color: #409eff;
    }
  }

  // 6 个图标按钮要挤进 190px：收紧 Element 默认的 mini 按钮左右内边距。
  .action-cell /deep/ .el-button--mini {
    padding-left: 5px;
    padding-right: 5px;
  }
</style>
