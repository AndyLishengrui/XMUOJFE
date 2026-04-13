<template>
  <div class="problem-list-page">
    <div class="search-hero">
      <div class="hero-search-row">
        <Input v-model="query.keyword"
               size="large"
               @on-enter="filterByKeyword"
               :placeholder="$t('m.Problem_Search_Placeholder')"
               icon="ios-search-strong"/>
        <Button type="primary" size="large" @click="filterByKeyword">
          {{$t('m.Search')}}
        </Button>
      </div>
      <div class="hero-tools-row">
        <Dropdown @on-click="filterByDifficulty" trigger="click">
          <Button size="large">
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
        <div class="view-switch-group">
          <div class="view-mode-switch">
            <div class="view-mode-copy">
              <span>{{$t('m.Show_Source')}}</span>
              <small>{{$t('m.Show_Source_Help')}}</small>
            </div>
            <i-switch :value="showSourceColumn" @on-change="handleSourceModeChange">
              <span slot="open">{{$t('m.On')}}</span>
              <span slot="close">{{$t('m.Off')}}</span>
            </i-switch>
          </div>
          <div class="view-mode-switch">
            <div class="view-mode-copy">
              <span>{{$t('m.Study_View')}}</span>
              <small>{{$t('m.Study_View_Help')}}</small>
            </div>
            <i-switch :value="showTagColumn" @on-change="handleViewModeChange">
              <span slot="open">{{$t('m.On')}}</span>
              <span slot="close">{{$t('m.Off')}}</span>
            </i-switch>
          </div>
        </div>
        <Button type="ghost" size="large" @click="onReset">
          <Icon type="refresh"></Icon>
          {{$t('m.Reset')}}
        </Button>
      </div>
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

    <Row type="flex" :gutter="18">
      <Col :span="19">
        <Panel shadow>
          <div slot="title">{{$t('m.Problem_List')}}</div>
          <div slot="extra" class="list-summary">
            <span>{{total}}</span>
            <span>{{$t('m.Problem_Search_Summary')}}</span>
          </div>
          <Table style="width: 100%; font-size: 15px;"
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
          @on-change="handlePageChange"
          @on-page-size-change="handlePageSizeChange"></Pagination>
      </Col>

      <Col :span="5">
        <div class="tag-sidebar-wrapper">
          <Panel :padding="12">
            <div slot="title" class="taglist-title">{{$t('m.Tags')}}</div>

            <div class="tag-search-box">
              <Input v-model="tagKeyword"
                     :placeholder="$t('m.Tag_Search_Placeholder')"
                     icon="ios-pricetags"/>
            </div>

            <div v-if="query.tag" class="tag-panel-section current-tag-section">
              <div class="section-title">{{$t('m.Current_Tag')}}</div>
              <div class="current-tag-row">
                <Tag color="blue">{{query.tag}}</Tag>
                <Button type="text" @click="clearTagFilter">{{$t('m.Clear_Filter')}}</Button>
              </div>
            </div>

            <div v-if="featuredTagList.length && !tagKeyword" class="tag-panel-section">
              <div class="section-title">{{$t('m.Popular_Tags')}}</div>
              <div class="tag-button-group">
                <Button v-for="tag in featuredTagList"
                        :key="'featured-' + tag.name"
                        @click="filterByTag(tag.name)"
                        :type="query.tag === tag.name ? 'primary' : 'ghost'"
                        shape="circle"
                        class="tag-btn">
                  {{tag.name}} ({{tag.problem_count}})
                </Button>
              </div>
            </div>

            <div class="tag-panel-section">
              <div class="section-title">{{tagKeyword ? $t('m.Tag_Search_Result') : $t('m.More_Tags')}}</div>
              <div v-if="visibleTagList.length" class="tag-button-group">
                <Button v-for="tag in visibleTagList"
                        :key="tag.name"
                        @click="filterByTag(tag.name)"
                        :type="query.tag === tag.name ? 'primary' : 'ghost'"
                        shape="circle"
                        class="tag-btn">
                  {{tag.name}} ({{tag.problem_count}})
                </Button>
              </div>
              <div v-else class="empty-tag-tip">{{$t('m.No_Tags_Found')}}</div>
              <Button v-if="canToggleMoreTags" type="text" long @click="tagsExpanded = !tagsExpanded">
                {{tagsExpanded ? $t('m.Collapse_Tags') : $t('m.Expand_Tags')}}
              </Button>
            </div>

            <Button long id="pick-one" @click="pickone">
              <Icon type="shuffle"></Icon>
              {{$t('m.Pick_One')}}
            </Button>
          </Panel>
          <Spin v-if="loadings.tag" fix size="large"></Spin>
        </div>
      </Col>
    </Row>
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
          limit: 10,
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
        this.query.limit = parseInt(query.limit) || 10
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
      pickone () {
        api.pickone().then(res => {
          this.$success('Good Luck')
          this.$router.push({name: 'problem-details', params: {problemID: res.data.data}})
        })
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
                  color: status === 0 ? '#19be6b' : '#ed3f14'
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
      'tagKeyword' () {
        this.tagsExpanded = false
        if (this.tagSearchTimer) {
          clearTimeout(this.tagSearchTimer)
        }
        this.tagSearchTimer = setTimeout(() => {
          this.getTagList()
        }, 180)
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
    gap: 18px;
  }

  .search-hero {
    padding: 18px 20px;
    border-radius: 14px;
    background: linear-gradient(135deg, #ffffff 0%, #f5f9ff 55%, #eef7ff 100%);
    border: 1px solid #e8f1ff;
    box-shadow: 0 10px 30px rgba(51, 119, 204, 0.08);
  }

  .hero-search-row,
  .hero-tools-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .hero-tools-row {
    margin-top: 12px;
    flex-wrap: wrap;
  }

  .view-switch-group {
    display: flex;
    align-items: stretch;
    gap: 12px;
    flex-wrap: wrap;
  }

  .hero-search-row .ivu-input-wrapper {
    flex: 1;
  }

  .view-mode-switch {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 210px;
    padding: 0 10px;
    border: 1px solid #e3e8ee;
    border-radius: 6px;
    min-height: 36px;
    background: #fff;
    color: #495060;
  }

  .view-mode-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.2;
  }

  .view-mode-copy small {
    color: #9ea7b4;
    font-size: 11px;
  }

  .active-filters-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-height: 48px;
    box-sizing: border-box;
    padding: 12px 14px;
    border-radius: 10px;
    background: #f8fbff;
    border: 1px solid #e4eefc;
  }

  .active-filters-label {
    color: #657180;
    font-size: 13px;
    margin-right: 2px;
  }

  .list-summary {
    color: #80848f;
    font-size: 13px;
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .list-summary span:first-child {
    font-size: 20px;
    color: #17233d;
    font-weight: 600;
  }

  .table-source-pill {
    display: inline-block;
    max-width: 100%;
    padding: 3px 10px;
    border: 1px solid #e3e8ee;
    border-radius: 4px;
    background: #f7f9fc;
    color: #495060;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }

  .tag-sidebar-wrapper {
    position: relative;
  }

  .tag-search-box {
    margin-bottom: 14px;
  }

  .taglist-title {
    margin-left: -10px;
    margin-bottom: -10px;
  }

  .tag-panel-section + .tag-panel-section {
    margin-top: 18px;
    padding-top: 18px;
    border-top: 1px solid #f0f0f0;
  }

  .section-title {
    font-size: 13px;
    color: #80848f;
    margin-bottom: 10px;
  }

  .current-tag-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .tag-button-group {
    display: flex;
    flex-wrap: wrap;
  }

  .tag-btn {
    margin-right: 8px;
    margin-bottom: 10px;
  }

  .empty-tag-tip {
    color: #9ea7b4;
    font-size: 13px;
    line-height: 1.6;
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
    color: #2d8cf0;
    background: #eef6ff;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .table-tag-chip-more {
    color: #657180;
    background: #f3f5f7;
    flex-shrink: 0;
  }

  .table-tag-empty {
    color: #9ea7b4;
  }

  /deep/ .ivu-table td {
    height: 52px;
  }

  /deep/ .ivu-table-cell {
    overflow: hidden;
  }

  #pick-one {
    margin-top: 18px;
  }
</style>
