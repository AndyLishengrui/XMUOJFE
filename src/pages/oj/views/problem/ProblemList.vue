<template>
  <div class="problem-list-page">
    <!-- 工具栏：搜索 / 难度 / 视图设置 / 重置 —— 全部压在一行 -->
    <div class="pl-toolbar">
      <Input v-model="query.keyword"
             @on-enter="filterByKeyword"
             :placeholder="$t('m.Problem_Search_Placeholder')"
             icon="ios-search-strong"
             class="pl-search"/>
      <Button type="primary" @click="filterByKeyword">
        {{$t('m.Search')}}
      </Button>

      <Dropdown @on-click="filterByDifficulty" trigger="click">
        <Button>
          {{currentDifficultyLabel}}
          <Icon type="arrow-down-b"></Icon>
        </Button>
        <Dropdown-menu slot="list">
          <Dropdown-item name="">{{$t('m.All')}}</Dropdown-item>
          <Dropdown-item name="Low">{{$t('m.Low')}}</Dropdown-item>
          <Dropdown-item name="Mid">{{$t('m.Mid')}}</Dropdown-item>
          <Dropdown-item name="High">{{$t('m.High')}}</Dropdown-item>
        </Dropdown-menu>
      </Dropdown>

      <!-- 标签筛选：全站有 327 个标签，侧栏永远列不完 → 改成「可搜索的下拉」 -->
      <Poptip v-model="tagPickerVisible" placement="bottom-end" width="380" trigger="click">
        <Button :type="query.tag ? 'primary' : 'default'">
          <Icon type="pricetags"></Icon>
          {{ query.tag || $t('m.Tags') }}
          <Icon type="arrow-down-b"></Icon>
        </Button>
        <div slot="content" class="tag-picker">
          <Input v-model="tagKeyword"
                 :placeholder="$t('m.Tag_Search_Placeholder')"
                 icon="ios-search-strong"/>
          <div class="tag-picker-list">
            <div v-if="query.tag" class="tag-picker-current">
              <span class="tag-picker-label">{{$t('m.Current_Tag')}}</span>
              <Tag color="blue" closable @on-close="clearTagFilter">{{query.tag}}</Tag>
            </div>
            <div class="tag-picker-cloud">
              <span v-for="tag in filteredTagList"
                    :key="tag.name"
                    class="tag-pill"
                    :class="{ 'is-active': query.tag === tag.name }"
                    @click="pickTag(tag.name)">{{tag.name}}</span>
            </div>
            <div v-if="!filteredTagList.length" class="tag-picker-empty">{{$t('m.No_Tags_Found')}}</div>
          </div>
        </div>
      </Poptip>

      <!-- 两个开关是「设置项」（设一次就不动），收进弹层，不再各占一个 210px 的盒子 -->
      <Poptip placement="bottom-end" width="300" trigger="click">
        <Button :type="showSourceColumn || showTagColumn ? 'primary' : 'default'"
                shape="circle" icon="gear-a"></Button>
        <div slot="content" class="view-options-panel">
          <div class="view-option">
            <div class="view-option-copy">
              <span>{{$t('m.Show_Source')}}</span>
              <small>{{$t('m.Show_Source_Help')}}</small>
            </div>
            <i-switch :value="showSourceColumn" @on-change="handleSourceModeChange">
              <span slot="open">{{$t('m.On')}}</span>
              <span slot="close">{{$t('m.Off')}}</span>
            </i-switch>
          </div>
          <div class="view-option">
            <div class="view-option-copy">
              <span>{{$t('m.Study_View')}}</span>
              <small>{{$t('m.Study_View_Help')}}</small>
            </div>
            <i-switch :value="showTagColumn" @on-change="handleViewModeChange">
              <span slot="open">{{$t('m.On')}}</span>
              <span slot="close">{{$t('m.Off')}}</span>
            </i-switch>
          </div>
        </div>
      </Poptip>

      <Button type="ghost" @click="onReset">
        <Icon type="refresh"></Icon>
        {{$t('m.Reset')}}
      </Button>
    </div>

    <div v-if="hasActiveFilters" class="active-filters-bar">
      <span class="active-filters-label">{{$t('m.Active_Filters')}}</span>
      <Tag v-if="query.keyword" closable color="blue" @on-close="removeKeywordFilter">
        {{$t('m.Keyword')}}: {{query.keyword}}
      </Tag>
      <Tag v-if="query.difficulty" closable color="gold" @on-close="removeDifficultyFilter">
        {{$t('m.Difficulty')}}: {{$t('m.' + query.difficulty)}}
      </Tag>
      <Tag v-if="query.tag" closable color="green" @on-close="clearTagFilter">
        {{$t('m.Tags')}}: {{query.tag}}
      </Tag>
    </div>

    <!-- 侧栏已去掉：标签筛选并进了工具栏，表格因此拿到全宽 -->
    <Panel shadow class="pl-panel">
      <div slot="title">{{$t('m.Problem_List')}}</div>
      <div slot="extra" class="list-summary">
        <span>{{total}}</span>
        <span>{{$t('m.Problem_Search_Summary')}}</span>
      </div>
      <Table class="pl-table"
             style="width: 100%;"
             :columns="tableColumns"
             :data="problemList"
             :loading="loadings.table"
             disabled-hover></Table>
    </Panel>
    <Pagination
      :total="total"
      :page-size.sync="query.limit"
      :current.sync="query.page"
      :show-sizer="true"
      :page-size-opts="[30, 50, 100, 200]"
      @on-change="handlePageChange"
      @on-page-size-change="handlePageSizeChange"></Pagination>
  </div>
</template>

<script>
  import { mapGetters } from 'vuex'
  import api from '@oj/api'
  import utils from '@/utils/utils'
  import { ProblemMixin } from '@oj/components/mixins'
  import Pagination from '@oj/components/Pagination'

  export default {
    name: 'ProblemList',
    mixins: [ProblemMixin],
    components: {
      Pagination
    },
    data () {
      return {
        tagList: [],
        problemList: [],
        total: 0,
        tagKeyword: '',
        tagPickerVisible: false,
        tagsExpanded: false,
        tagSearchTimer: null,
        showSourceColumn: false,
        showTagColumn: false,
        loadings: {
          table: true,
          tag: true
        },
        routeName: '',
        query: {
          keyword: '',
          difficulty: '',
          tag: '',
          page: 1,
          limit: 30,
          view: '',
          source: '0'
        }
      }
    },
    mounted () {
      this.init()
    },
    beforeDestroy () {
      if (this.tagSearchTimer) {
        clearTimeout(this.tagSearchTimer)
      }
    },
    methods: {
      init (simulate = false) {
        this.routeName = this.$route.name
        let query = this.$route.query
        this.query.difficulty = query.difficulty || ''
        this.query.keyword = query.keyword || ''
        this.query.tag = query.tag || ''
        this.query.page = parseInt(query.page) || 1
        if (this.query.page < 1) {
          this.query.page = 1
        }
        // 每页 30 起（10 条太稀疏）；URL 里带了非法档位也回落到 30
        const limitOpts = [30, 50, 100, 200]
        this.query.limit = limitOpts.indexOf(parseInt(query.limit)) !== -1
          ? parseInt(query.limit)
          : 30
        this.query.view = query.view === 'study' ? 'study' : ''
        this.query.source = query.source === '1' ? '1' : '0'
        this.showSourceColumn = this.query.source !== '0'
        this.showTagColumn = this.query.view === 'study'
        if (!simulate) {
          this.getTagList()
        }
        this.getProblemList()
      },
      pushRouter () {
        this.$router.push({
          name: 'problem-list',
          query: utils.filterEmptyValue(this.query)
        })
      },
      getProblemList () {
        let offset = (this.query.page - 1) * this.query.limit
        let searchQuery = {
          difficulty: this.query.difficulty,
          keyword: this.query.keyword,
          tag: this.query.tag
        }
        this.loadings.table = true
        api.getProblemList(offset, this.query.limit, searchQuery).then(res => {
          this.loadings.table = false
          this.total = res.data.data.total
          this.problemList = res.data.data.results
        }, res => {
          this.loadings.table = false
        })
      },
      getTagList () {
        this.loadings.tag = true
        api.getProblemTagList({ keyword: this.tagKeyword }).then(res => {
          this.tagList = res.data.data
          this.loadings.tag = false
        }, res => {
          this.loadings.tag = false
        })
      },
      filterByTag (tagName) {
        this.query.tag = tagName
        this.query.page = 1
        this.pushRouter()
      },
      // 弹层里点标签：筛选 + 收起弹层（并清掉搜索词，下次打开是完整列表）
      pickTag (tagName) {
        this.filterByTag(tagName)
        this.tagPickerVisible = false
        this.tagKeyword = ''
      },
      clearTagFilter () {
        this.query.tag = ''
        this.query.page = 1
        this.pushRouter()
      },
      filterByDifficulty (difficulty) {
        this.query.difficulty = difficulty
        this.query.page = 1
        this.pushRouter()
      },
      filterByKeyword () {
        this.query.page = 1
        this.pushRouter()
      },
      handleViewModeChange (value) {
        this.showTagColumn = value
        this.query.view = value ? 'study' : ''
        this.pushRouter()
      },
      handleSourceModeChange (value) {
        this.showSourceColumn = value
        this.query.source = value ? '1' : '0'
        this.pushRouter()
      },
      disableStudyView () {
        this.showTagColumn = false
        this.query.view = ''
        this.pushRouter()
      },
      removeKeywordFilter () {
        this.query.keyword = ''
        this.query.page = 1
        this.pushRouter()
      },
      removeDifficultyFilter () {
        this.query.difficulty = ''
        this.query.page = 1
        this.pushRouter()
      },
      handlePageChange (page) {
        this.query.page = page
        this.pushRouter()
      },
      handlePageSizeChange (pageSize) {
        this.query.limit = pageSize
        this.query.page = 1
        this.pushRouter()
      },
      onReset () {
        this.tagKeyword = ''
        this.tagsExpanded = false
        this.showSourceColumn = false
        this.query.source = '0'
        this.showTagColumn = false
        this.query.view = ''
        this.$router.push({name: 'problem-list'})
      },
      renderProblemLink (h, params) {
        return h('Button', {
          props: {
            type: 'text',
            size: 'large'
          },
          on: {
            click: () => {
              this.$router.push({name: 'problem-details', params: {problemID: params.row._id}})
            }
          },
          style: {
            padding: '2px 0'
          }
        }, params.row._id)
      },
      renderTitleLink (h, params) {
        return h('Button', {
          props: {
            type: 'text',
            size: 'large'
          },
          on: {
            click: () => {
              this.$router.push({name: 'problem-details', params: {problemID: params.row._id}})
            }
          },
          style: {
            padding: '2px 0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'left',
            width: '100%'
          },
          attrs: {
            title: params.row.title
          }
        }, params.row.title)
      },
      renderDifficulty (h, params) {
        let color = 'blue'
        if (params.row.difficulty === 'Low') color = 'green'
        else if (params.row.difficulty === 'High') color = 'yellow'
        return h('Tag', {
          props: {
            color: color
          }
        }, this.$i18n.t('m.' + params.row.difficulty))
      },
      renderSource (h, params) {
        const source = params.row.source || '-'
        return h('span', {
          class: 'table-source-pill',
          attrs: {
            title: source
          }
        }, source)
      },
      renderTagSummary (h, params) {
        const tags = params.row.tags || []
        if (tags.length === 0) {
          return h('span', {
            class: 'table-tag-empty'
          }, '-')
        }
        const primaryTag = tags[0]
        const children = [h('span', {
          class: 'table-tag-chip table-tag-chip-primary',
          attrs: {
            title: primaryTag
          },
          on: {
            click: () => {
              this.filterByTag(primaryTag)
            }
          }
        }, primaryTag)]
        if (tags.length > 1) {
          children.push(h('span', {
            class: 'table-tag-chip table-tag-chip-more',
            attrs: {
              title: tags.slice(1).join(' / ')
            }
          }, '+' + (tags.length - 1)))
        }
        return h('div', {
          class: 'table-tag-list',
          attrs: {
            title: tags.join(' / ')
          }
        }, children)
      }
    },
    computed: {
      ...mapGetters(['isAuthenticated']),
      currentDifficultyLabel () {
        return this.query.difficulty === '' ? this.$i18n.t('m.Difficulty') : this.$i18n.t('m.' + this.query.difficulty)
      },
      hasActiveFilters () {
        return !!(this.query.keyword || this.query.difficulty || this.query.tag)
      },
      sortedTagList () {
        return this.tagList.slice().sort((left, right) => {
          if ((right.problem_count || 0) !== (left.problem_count || 0)) {
            return (right.problem_count || 0) - (left.problem_count || 0)
          }
          return left.name.localeCompare(right.name)
        })
      },
      featuredTagList () {
        return this.sortedTagList.slice(0, 8)
      },
      filteredTagList () {
        let keyword = this.tagKeyword.trim().toLowerCase()
        return this.sortedTagList.filter(tag => {
          if (!keyword) {
            return true
          }
          return tag.name.toLowerCase().indexOf(keyword) !== -1
        })
      },
      visibleTagList () {
        if (this.tagsExpanded) {
          return this.filteredTagList
        }
        return this.filteredTagList.slice(0, 28)
      },
      canToggleMoreTags () {
        return this.filteredTagList.length > 28
      },
      shouldShowStatusColumn () {
        return this.isAuthenticated && this.problemList.some(item => item.my_status !== null && item.my_status !== undefined)
      },
      tableColumns () {
        let columns = []
        if (this.shouldShowStatusColumn) {
          columns.push({
            width: 60,
            title: ' ',
            render: (h, params) => {
              let status = params.row.my_status
              if (status === null || status === undefined) {
                return undefined
              }
              return h('Icon', {
                props: {
                  type: status === 0 ? 'checkmark-round' : 'minus-round',
                  size: '16'
                },
                style: {
                  color: status === 0 ? 'var(--c-success)' : 'var(--c-error)'
                }
              })
            }
          })
        }
        columns.push(
          {
            title: '#',
            key: '_id',
            width: 80,
            render: this.renderProblemLink
          },
          {
            title: this.$i18n.t('m.Title'),
            width: this.showSourceColumn ? 320 : 420,
            render: this.renderTitleLink
          }
        )
        if (this.showSourceColumn) {
          columns.push({
            title: this.$i18n.t('m.Source'),
            width: 170,
            render: this.renderSource
          })
        }
        if (this.showTagColumn) {
          columns.push({
            title: this.$i18n.t('m.Tags'),
            width: 150,
            render: this.renderTagSummary
          })
        }
        columns.push(
          {
            title: this.$i18n.t('m.Level'),
            width: 110,
            render: this.renderDifficulty
          },
          {
            title: this.$i18n.t('m.Total'),
            key: 'submission_number',
            width: 100
          },
          {
            title: this.$i18n.t('m.AC_Rate'),
            width: 120,
            render: (h, params) => {
              return h('span', this.getACRate(params.row.accepted_number, params.row.submission_number))
            }
          }
        )
        return columns
      }
    },
    watch: {
      '$route' (newVal, oldVal) {
        if (newVal !== oldVal) {
          this.init(true)
        }
      },
      'isAuthenticated' (newVal) {
        if (newVal === true) {
          this.init()
        }
      }
    }
  }
</script>

<style scoped lang="less">
  .problem-list-page {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* 工具栏：一行放下所有筛选控件（原来是两行 large 控件 + 一个大渐变 hero） */
  .pl-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--c-bg-card);
    border: 1px solid var(--c-border);
  }

  /* 搜索框吃掉剩余宽度，控件都靠右排 */
  .pl-search {
    flex: 1 1 260px;
    min-width: 200px;
  }

  /* ── 标签选择弹层 ──────────────────────────────────────
     全站 327 个标签，靠「搜索 + 紧凑 pill 云」，而不是长列表按钮 */
  .tag-picker .ivu-input-wrapper {
    margin-bottom: 10px;
  }

  .tag-picker-list {
    max-height: 300px;
    overflow-y: auto;
    margin-right: -4px;
    padding-right: 4px;
  }

  .tag-picker-current {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--c-border);
  }

  .tag-picker-label {
    font-size: 12px;
    color: var(--c-text-3);
  }

  .tag-picker-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tag-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 18px;
    color: var(--c-text-2);
    background: var(--c-bg-soft);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background .15s, color .15s;
  }

  .tag-pill:hover {
    color: var(--c-brand);
    background: var(--c-brand-tint);
  }

  .tag-pill.is-active {
    color: var(--c-text-inverse);
    background: var(--c-brand);
    border-color: var(--c-brand);
  }

  .tag-picker-empty {
    padding: 24px 0;
    text-align: center;
    font-size: 12px;
    color: var(--c-text-3);
  }

  /* 齿轮弹层里的两个开关 */
  .view-options-panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 2px;
  }

  .view-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .view-option-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.35;
  }

  .view-option-copy span {
    color: var(--c-text-1);
    font-size: 13px;
  }

  .view-option-copy small {
    color: var(--c-text-3);
    font-size: 11px;
  }

  .active-filters-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    box-sizing: border-box;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--c-brand-tint);
    border: 1px solid var(--c-brand-tint);
  }

  .active-filters-label {
    color: var(--c-text-2);
    font-size: 13px;
    margin-right: 2px;
  }

  .list-summary {
    color: var(--c-text-3);
    font-size: 13px;
    display: flex;
    gap: 6px;
    align-items: center;
  }

  /* ── 表格：原来是 15px，偏大；顺带把行高收紧 ───────────── */
  .pl-table {
    font-size: 13px;

    /deep/ .ivu-table {
      font-size: 13px;
    }

    /deep/ .ivu-table th {
      height: 40px;
      font-size: 13px;
      font-weight: 600;
    }

    /deep/ .ivu-table td {
      height: 44px;
      padding: 0 12px;
      font-size: 13px;
    }
  }

  .list-summary span:first-child {
    font-size: 16px;
    color: var(--c-text-1);
    font-weight: 600;
  }

  .table-source-pill {
    display: inline-block;
    max-width: 100%;
    padding: 2px 8px;
    font-size: 12px;
    line-height: 18px;
    border: 1px solid var(--c-border);
    border-radius: 4px;
    background: var(--c-bg-hover);
    color: var(--c-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }

  /* 面板标题条：iView 默认 padding 14/16 + 16px 字，整条偏高，压一压 */
  .problem-list-page /deep/ .ivu-card-head {
    padding: 10px 14px;
    min-height: auto;
  }

  .problem-list-page /deep/ .ivu-card-head p {
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
  }










  .table-tag-list {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    overflow: hidden;
    white-space: nowrap;
  }

  .table-tag-chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 18px;
    white-space: nowrap;
  }

  .table-tag-chip-primary {
    cursor: pointer;
    color: var(--c-brand);
    background: var(--c-brand-tint);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .table-tag-chip-more {
    color: var(--c-text-2);
    background: var(--c-bg-hover);
    flex-shrink: 0;
  }

  .table-tag-empty {
    color: var(--c-text-3);
  }

  /deep/ .ivu-table td {
    height: 52px;
  }

  /deep/ .ivu-table-cell {
    overflow: hidden;
  }
</style>
