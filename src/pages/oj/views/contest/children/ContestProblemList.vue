<template>
  <div>
    <Panel>
      <div slot="title" class="title-bar">
        <span>{{$t('m.Problems_List')}}</span>
        <span v-if="isAuthenticated" class="progress-stats">
          ({{ completedCount }}/{{ problems.length }})
        </span>
        <i-switch
          v-if="isAuthenticated && completedCount > 0"
          v-model="hideCompleted"
          size="small"
          class="hide-completed-switch"
          @on-change="onHideCompletedChange">
          <span slot="open">{{$t('m.Show_All')}}</span>
          <span slot="close">{{$t('m.Hide_Completed')}}</span>
        </i-switch>
        <div class="view-toggles">
          <div class="view-mode-switch">
            <span class="view-mode-label">{{$t('m.Show_Source')}}</span>
            <i-switch v-model="showSourceColumn" size="small" @on-change="onToggleChange">
              <span slot="open">{{$t('m.On')}}</span>
              <span slot="close">{{$t('m.Off')}}</span>
            </i-switch>
          </div>
          <div class="view-mode-switch">
            <span class="view-mode-label">{{$t('m.Study_View')}}</span>
            <i-switch v-model="showTagColumn" size="small" @on-change="onToggleChange">
              <span slot="open">{{$t('m.On')}}</span>
              <span slot="close">{{$t('m.Off')}}</span>
            </i-switch>
          </div>
        </div>
      </div>
      <Table v-if="contestRuleType == 'ACM' || OIContestRealTimePermission"
             :columns="ACMTableColumns"
             :data="displayProblems"
             @on-row-click="goContestProblem"
             :no-data-text="$t('m.No_Problems')"></Table>
      <Table v-else
             :data="displayProblems"
             :columns="OITableColumns"
             @on-row-click="goContestProblem"
             no-data-text="$t('m.No_Problems')"></Table>
    </Panel>
  </div>
</template>

<script>
  import {mapState, mapGetters} from 'vuex'
  import {ProblemMixin} from '@oj/components/mixins'
  import utils from '@/utils/utils'

  export default {
    name: 'ContestProblemList',
    mixins: [ProblemMixin],
    data () {
      return {
        hideCompleted: false,
        showSourceColumn: false,
        showTagColumn: false
      }
    },
    mounted () {
      this.getContestProblems()
    },
    created () {
      const cid = this.$route.params.contestID
      const saved = localStorage.getItem(`contest_${cid}_hide_completed`)
      this.hideCompleted = saved === '1'
      const savedSource = localStorage.getItem(`contest_${cid}_show_source`)
      this.showSourceColumn = savedSource === '1'
      const savedTag = localStorage.getItem(`contest_${cid}_show_tags`)
      this.showTagColumn = savedTag === '1'
    },
    methods: {
      getContestProblems () {
        this.$store.dispatch('getContestProblems').then(res => {
          // Trigger reactivity
        })
      },
      goContestProblem (row) {
        this.$router.push({
          name: 'contest-problem-details',
          params: {
            contestID: this.$route.params.contestID,
            problemID: row._id
          }
        })
      },
      onHideCompletedChange (val) {
        localStorage.setItem(`contest_${this.$route.params.contestID}_hide_completed`, val ? '1' : '0')
      },
      onToggleChange () {
        const cid = this.$route.params.contestID
        localStorage.setItem(`contest_${cid}_show_source`, this.showSourceColumn ? '1' : '0')
        localStorage.setItem(`contest_${cid}_show_tags`, this.showTagColumn ? '1' : '0')
      },
      renderDifficulty (h, params) {
        const d = params.row.difficulty
        let color = 'blue'
        if (d === 'Low') color = 'green'
        else if (d === 'High') color = 'yellow'
        return h('Tag', { props: { color } }, this.$i18n.t('m.' + d))
      },
      renderSource (h, params) {
        const source = params.row.source || '-'
        return h('span', {
          class: 'table-source-pill',
          attrs: { title: source }
        }, source)
      },
      renderTagSummary (h, params) {
        const tags = params.row.tags || []
        if (tags.length === 0) {
          return h('span', { class: 'table-tag-empty' }, '-')
        }
        const primaryTag = tags[0]
        const children = [h('span', {
          class: 'table-tag-chip table-tag-chip-primary',
          attrs: { title: primaryTag }
        }, primaryTag)]
        if (tags.length > 1) {
          children.push(h('span', {
            class: 'table-tag-chip table-tag-chip-more',
            attrs: { title: tags.slice(1).join(' / ') }
          }, '+' + (tags.length - 1)))
        }
        return h('div', {
          class: 'table-tag-list',
          attrs: { title: tags.join(' / ') }
        }, children)
      }
    },
    computed: {
      ...mapState({
        problems: state => state.contest.contestProblems
      }),
      ...mapGetters(['isAuthenticated', 'contestRuleType', 'OIContestRealTimePermission']),
      completedCount () {
        return this.problems.filter(p => p.my_status === 0).length
      },
      displayProblems () {
        if (!this.hideCompleted) return this.problems
        return this.problems.filter(p => p.my_status !== 0)
      },
      shouldShowStatusColumn () {
        return this.isAuthenticated && this.problems.some(
          item => item.my_status !== null && item.my_status !== undefined && item.my_status >= 0
        )
      },
      ACMTableColumns () {
        let columns = []
        if (this.shouldShowStatusColumn) {
          columns.push({
            width: 50,
            title: ' ',
            render: (h, params) => {
              let status = params.row.my_status
              if (status === null || status === undefined) return undefined
              return h('Icon', {
                props: { type: status === 0 ? 'checkmark-round' : 'minus-round', size: '16' },
                style: { color: status === 0 ? '#19be6b' : '#ed3f14' }
              })
            }
          })
        }
        columns.push(
          { title: '#', key: '_id', sortType: 'asc', sortable: true,
            sortMethod: (a, b) => utils.compareDisplayId(a._id, b._id), width: 130 },
          { title: this.$i18n.t('m.Title'), key: 'title', minWidth: 160 }
        )
        if (this.showSourceColumn) {
          columns.push({
            title: this.$i18n.t('m.Source'), key: 'source',
            width: 130, render: this.renderSource
          })
        }
        if (this.showTagColumn) {
          columns.push({
            title: this.$i18n.t('m.Tags'), width: 140, render: this.renderTagSummary
          })
        }
        if (this.showSourceColumn || this.showTagColumn) {
          columns.push({
            title: this.$i18n.t('m.Level'), key: 'difficulty',
            width: 80, render: this.renderDifficulty
          })
        }
        columns.push(
          { title: this.$i18n.t('m.Total'), key: 'submission_number', width: 90 },
          { title: this.$i18n.t('m.AC_Rate'), width: 110,
            render: (h, params) => h('span', this.getACRate(params.row.accepted_number, params.row.submission_number))
          }
        )
        return columns
      },
      OITableColumns () {
        let columns = [
          { title: '#', key: '_id', sortable: true,
            sortMethod: (a, b) => utils.compareDisplayId(a._id, b._id), width: 130 },
          { title: this.$i18n.t('m.Title'), key: 'title', minWidth: 160 }
        ]
        if (this.showSourceColumn) {
          columns.push({
            title: this.$i18n.t('m.Source'), key: 'source',
            width: 130, render: this.renderSource
          })
        }
        if (this.showTagColumn) {
          columns.push({
            title: this.$i18n.t('m.Tags'), width: 140, render: this.renderTagSummary
          })
        }
        if (this.showSourceColumn || this.showTagColumn) {
          columns.push({
            title: this.$i18n.t('m.Level'), key: 'difficulty',
            width: 80, render: this.renderDifficulty
          })
        }
        return columns
      }
    },
    watch: {
      '$route' (newVal, oldVal) {
        if (newVal !== oldVal) {
          const cid = this.$route.params.contestID
          this.hideCompleted = localStorage.getItem(`contest_${cid}_hide_completed`) === '1'
          this.showSourceColumn = localStorage.getItem(`contest_${cid}_show_source`) === '1'
          this.showTagColumn = localStorage.getItem(`contest_${cid}_show_tags`) === '1'
        }
      },
      isAuthenticated (val, oldVal) {
        if (val && !oldVal) {
          this.getContestProblems()
        }
      }
    }
  }
</script>

<style scoped lang="less">
  .title-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    .progress-stats {
      font-size: 14px;
      color: #808695;
      margin-left: 12px;
      font-weight: normal;
    }
    .hide-completed-switch {
      margin-left: 16px;
    }
    .view-toggles {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: auto;
    }
    .view-mode-switch {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .view-mode-label {
      font-size: 13px;
      color: #808695;
      white-space: nowrap;
    }
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
    font-size: 12px;
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
    font-size: 12px;
  }
</style>
