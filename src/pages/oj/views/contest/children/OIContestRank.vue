<template>
  <Panel v-if="canViewContestRank" shadow>
    <div slot="title">{{ contest.title }}</div>
    <div slot="extra">
      <screen-full :height="18" :width="18" class="screen-full"></screen-full>
      <Poptip trigger="hover" placement="left-start">
        <Icon type="android-settings" size="20"></Icon>
        <div slot="content" id="switches">
          <p>
            <span>{{$t('m.Menu')}}</span>
            <i-switch v-model="showMenu"></i-switch>
            <span>{{$t('m.Chart')}}</span>
            <i-switch v-model="showChart"></i-switch>
          </p>
          <p>
            <span>{{$t('m.Auto_Refresh')}}(10s)</span>
            <i-switch :disabled="refreshDisabled" @on-change="handleAutoRefresh"></i-switch>
          </p>
          <p v-if="isContestAdmin">
            <span>{{$t('m.RealName')}}</span>
            <i-switch v-model="showRealName"></i-switch>
          </p>
          <p>
            <Button type="primary" size="small" @click="downloadRankCSV">{{$t('m.download_csv')}}</Button>
          </p>
        </div>
      </Poptip>
    </div>
    <div v-show="showChart" class="echarts">
      <ECharts :options="options" ref="chart" auto-resize></ECharts>
    </div>
        <!-- 不设 height：表格有多行就多高，高度跟着"每页条数"变（老师要求），
             页面整体滚动。横向滚动是 iView 按实测宽度自己开的（.ivu-table-overflowX）。 -->
        <Table ref="tableRank"
          class="contest-rank-table"
          :columns="columns"
          :data="dataRank"></Table>
    <Pagination :total="total"
                :page-size.sync="limit"
                :current.sync="page"
                @on-change="getContestRankData"
                @on-page-size-change="getContestRankData(1)"
                show-sizer></Pagination>
  </Panel>
</template>
<script>
  import { mapActions, mapGetters } from 'vuex'

  import Pagination from '@oj/components/Pagination'
  import ContestRankMixin from './contestRankMixin'
  import utils from '@/utils/utils'

  export default {
    name: 'acm-contest-rank',
    components: {
      Pagination
    },
    mixins: [ContestRankMixin],
    data () {
      return {
        total: 0,
        page: 1,
        contestID: '',
        // ⚠️ 前几列固定 width + fixed:'left'（冻结）：题目一多表格要横向滚动 6000+ px，
        //    不冻住就看不出「这一行是谁」。iView 会把带 fixed 的列挪到最前，
        //    我们冻的就是最前面这几列，视觉顺序不变。
        // ⚠️ 冻结区宽度必须恒定 —— 所以题目列用 minWidth（见下），富余宽度只摊给题目列。
        columns: [
          {
            align: 'center',
            width: 60,
            fixed: 'left',
            className: 'rank-col-compact',
            render: (h, params) => {
              return h('span', {}, params.index + (this.page - 1) * this.limit + 1)
            }
          },
          {
            title: this.$i18n.t('m.User_User'),
            align: 'center',
            width: 220,
            fixed: 'left',
            className: 'rank-col-user',
            render: (h, params) => {
              return h('a', {
                class: 'rank-user-link',
                style: {
                  display: 'inline-block'
                },
                on: {
                  click: () => {
                    this.$router.push(
                      {
                        name: 'user-home',
                        query: {username: params.row.user.username}
                      })
                  }
                }
              }, params.row.user.username)
            }
          },
          {
            title: this.$i18n.t('m.Total_Score'),
            align: 'center',
            width: 90,
            fixed: 'left',
            className: 'rank-col-compact',
            render: (h, params) => {
              return h('a', {
                class: 'rank-score-link',
                on: {
                  click: () => {
                    this.$router.push({
                      name: 'contest-submission-list',
                      query: {username: params.row.user.username}
                    })
                  }
                }
              }, params.row.total_score)
            }
          }
        ],
        dataRank: [],
        options: {
          title: {
            text: this.$i18n.t('m.Top_10_Teams'),
            left: 'center'
          },
          tooltip: {
            trigger: 'axis'
          },
          toolbox: {
            show: true,
            feature: {
              dataView: {show: true, readOnly: true},
              magicType: {show: true, type: ['line', 'bar']},
              saveAsImage: {show: true}
            },
            right: '10%'
          },
          calculable: true,
          xAxis: [
            {
              type: 'category',
              data: ['root'],
              boundaryGap: true,
              axisLabel: {
                interval: 0,
                showMinLabel: true,
                showMaxLabel: true,
                align: 'center',
                formatter: (value, index) => {
                  return utils.breakLongWords(value, 14)
                }
              },
              axisTick: {
                alignWithLabel: true
              }
            }
          ],
          yAxis: [
            {
              type: 'value'
            }
          ],
          series: [
            {
              name: this.$i18n.t('m.Score'),
              type: 'bar',
              barMaxWidth: '80',
              data: [0],
              markPoint: {
                data: [
                  {type: 'max', name: 'max'}
                ]
              }
            }
          ]
        }
      }
    },
    mounted () {
      this.contestID = this.$route.params.contestID
      this.getContestRankData(1)
      if (this.contestProblems.length === 0) {
        this.getContestProblems().then((res) => {
          this.addTableColumns(res.data.data)
        })
      } else {
        this.addTableColumns(this.contestProblems)
      }
    },
    computed: {
      ...mapGetters(
        ['canViewContestRank']
      )
    },
    methods: {
      ...mapActions(['getContestProblems']),
      getProblemColumnWidth (problemCount) {
        return problemCount > 15 ? 72 : 90
      },
      applyToChart (rankData) {
        let [usernames, scores] = [[], []]
        rankData.forEach(ele => {
          usernames.push(ele.user.username)
          scores.push(ele.total_score)
        })
        this.options.xAxis[0].data = usernames
        this.options.series[0].data = scores
      },
      applyToTable (data) {
        // deepcopy
        let dataRank = JSON.parse(JSON.stringify(data))
        // 从submission_info中取出相应的problem_id 放入到父object中,这么做主要是为了适应iview table的data格式
        // 见https://www.iviewui.com/components/table
        dataRank.forEach((rank, i) => {
          let info = rank.submission_info
          Object.keys(info).forEach(problemID => {
            dataRank[i][problemID] = info[problemID]
          })
        })
        this.dataRank = dataRank
      },
      addTableColumns (problems) {
        let problemColumnWidth = this.getProblemColumnWidth(problems.length)
        problems.forEach(problem => {
          this.columns.push({
            align: 'center',
            key: problem.id,
            // 用 minWidth 而不是 width：题目多时保持这一档宽度（表格撑到设计宽度、横向滚动），
            // 题目少时富余宽度摊给题目列（照样铺满面板），两种情形下冻结区都不变宽。
            minWidth: problemColumnWidth,
            className: 'rank-problem-col',
            renderHeader: (h, params) => {
              return h('a', {
                'class': {
                  'emphasis': true
                },
                // 表头只显示题号（P07），悬停给出完整题名
                attrs: {
                  title: problem.title
                },
                on: {
                  click: () => {
                    this.$router.push({
                      name: 'contest-problem-details',
                      params: {
                        contestID: this.contestID,
                        problemID: problem._id
                      }
                    })
                  }
                }
              }, problem._id)
            },
            render: (h, params) => {
              return h('span', params.row[problem.id])
            }
          })
        })
      },
      downloadRankCSV () {
        utils.downloadFile(`contest_rank?download_csv=1&contest_id=${this.$route.params.contestID}&force_refrash=${this.forceUpdate ? '1' : '0'}`)
      }
    }
  }
</script>
<style scoped lang="less">
  .echarts {
    margin: 20px auto;
    height: 400px;
    width: 98%;
  }

  .screen-full {
    margin-right: 8px;
  }

  #switches {
    p {
      margin-top: 5px;
      &:first-child {
        margin-top: 0;
      }
      span {
        margin-left: 8px;
      }
    }
  }

  .contest-rank-table /deep/ .ivu-table-cell {
    white-space: nowrap;
    word-break: normal;
    overflow: visible;
    line-height: 1.2;
    padding-left: 6px;
    padding-right: 6px;
  }

  .contest-rank-table /deep/ th,
  .contest-rank-table /deep/ td {
    height: 36px;
  }

  .contest-rank-table /deep/ th > .ivu-table-cell,
  .contest-rank-table /deep/ td > .ivu-table-cell {
    padding-top: 6px;
    padding-bottom: 6px;
  }

  .contest-rank-table /deep/ .rank-user-link,
  .contest-rank-table /deep/ .rank-score-link {
    display: inline-block;
    white-space: nowrap;
    word-break: normal;
  }
</style>
