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
        ACMTableColumns: [
          {
            title: '#',
            key: '_id',
            sortType: 'asc',
            sortable: true,
            sortMethod: (a, b) => utils.compareDisplayId(a._id, b._id),
            width: 150
          },
          {
            title: this.$i18n.t('m.Title'),
            key: 'title'
          },
          {
            title: this.$i18n.t('m.Total'),
            key: 'submission_number'
          },
          {
            title: this.$i18n.t('m.AC_Rate'),
            render: (h, params) => {
              return h('span', this.getACRate(params.row.accepted_number, params.row.submission_number))
            }
          }
        ],
        OITableColumns: [
          {
            title: '#',
            key: '_id',
            sortable: true,
            sortMethod: (a, b) => utils.compareDisplayId(a._id, b._id),
            width: 150
          },
          {
            title: this.$i18n.t('m.Title'),
            key: 'title'
          }
        ]
      }
    },
    mounted () {
      this.getContestProblems()
    },
    created () {
      const saved = localStorage.getItem(`contest_${this.$route.params.contestID}_hide_completed`)
      this.hideCompleted = saved === '1'
    },
    methods: {
      ensureStatusColumn (problems) {
        if (!this.isAuthenticated) {
          return
        }
        if (this.contestRuleType === 'ACM') {
          this.addStatusColumn(this.ACMTableColumns, problems)
        } else if (this.OIContestRealTimePermission) {
          this.addStatusColumn(this.ACMTableColumns, problems)
        }
      },
      getContestProblems () {
        this.$store.dispatch('getContestProblems').then(res => {
          this.ensureStatusColumn(res.data.data)
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
      }
    },
    watch: {
      isAuthenticated (val, oldVal) {
        if (val && !oldVal) {
          this.getContestProblems()
        }
      },
      problems (val) {
        if (Array.isArray(val) && val.length > 0) {
          this.ensureStatusColumn(val)
        }
      }
    }
  }
</script>

<style scoped lang="less">
  .title-bar {
    display: flex;
    align-items: center;
    .progress-stats {
      font-size: 14px;
      color: #808695;
      margin-left: 12px;
      font-weight: normal;
    }
    .hide-completed-switch {
      margin-left: 16px;
    }
  }
</style>
