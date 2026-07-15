<template>
  <Row type="flex" justify="space-around">
    <Col :span="20" id="status">
      <Alert :type="status.type" showIcon>
        <span class="title">{{$t('m.' + status.statusName.replace(/ /g, "_"))}}</span>
        <span class="title" v-if="isCE">[main.c:后面的两个数字分别表示错误代码所在的“行号”和“列号”]</span>
        <div slot="desc" class="content">
          <template v-if="isCE">
            <!--
            请选择出错信息的语言：
            <i-switch size="large" v-model="isCn">
                <span slot="open">中文</span>
                <span slot="close">English</span>
            </i-switch>
            <pre v-if="isCn">{{submission.statistic_info.err_info_cn}}</pre>
            <pre v-else>{{submission.statistic_info.err_info}}</pre>
            -->
            <pre>{{submission.statistic_info.err_info}}</pre>
          </template>
          <template v-else>
            <span>{{$t('m.Time')}}: {{submission.statistic_info.time_cost | submissionTime}}</span>
            <span>{{$t('m.Memory')}}: {{submission.statistic_info.memory_cost | submissionMemory}}</span>
            <span>{{$t('m.Lang')}}: {{submission.language}}</span>
            <span>{{$t('m.Author')}}: {{submission.username}}</span>
          </template>
        </div>
      </Alert>
    </Col>

    <!--后台返info就显示出来， 权限控制放后台 -->
    <Col v-if="submission.info && !isCE" :span="20">
      <Table stripe :loading="loading" :disabled-hover="true" :columns="columns" :data="submission.info.data"></Table>
    </Col>

    <Col :span="20">
      <Highlight :code="submission.code" :language="submission.language" :border-color="status.color"></Highlight>
    </Col>

    <!-- 算法助教分析：仅WA时显示，无报告则零影响 -->
    <Col v-if="coachReport" :span="20" style="margin-top: 16px;">
      <div style="background: #fff; border: 1px solid #e8e8e8; border-radius: 4px; padding: 16px;">
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #333;">
          💡 算法助教分析
          <span v-if="coachReport.status === 'done'" style="color: #19be6b; font-size: 12px; margin-left: 8px;">已确认</span>
        </div>
        <div v-if="coachReport.code_analysis" style="margin-bottom: 10px;">
          <div style="font-weight: 600; color: #555; margin-bottom: 4px;">📋 代码分析</div>
          <div style="white-space: pre-wrap; color: #666; line-height: 1.7;">{{coachReport.code_analysis}}</div>
        </div>
        <div v-if="coachReport.hints" style="margin-bottom: 10px;">
          <div style="font-weight: 600; color: #555; margin-bottom: 4px;">💡 改进提示</div>
          <div style="white-space: pre-wrap; color: #666; line-height: 1.7;">{{coachReport.hints}}</div>
        </div>
        <div v-if="coachReport.common_pitfall" style="margin-bottom: 10px;">
          <div style="font-weight: 600; color: #555; margin-bottom: 4px;">⚠️ 常见陷阱</div>
          <div style="white-space: pre-wrap; color: #666; line-height: 1.7;">{{coachReport.common_pitfall}}</div>
        </div>
      </div>
    </Col>

    <Col v-if="submission.can_unshare" :span="20">
      <div id="share-btn">
        <Button v-if="submission.shared"
                type="warning" size="large" @click="shareSubmission(false)">
          {{$t('m.UnShare')}}
        </Button>
        <Button v-else
                type="primary" size="large" @click="shareSubmission(true)">
          {{$t('m.Share')}}
        </Button>
      </div>
    </Col>
  </Row>

</template>

<script>
  import api from '@oj/api'
  import {JUDGE_STATUS} from '@/utils/constants'
  import utils from '@/utils/utils'
  import Highlight from '@/pages/oj/components/Highlight'
  import axios from 'axios'

  export default {
    name: 'submissionDetails',
    components: {
      Highlight
    },
    data () {
      return {
        isCn: true,
        coachReport: null,
        columns: [
          {
            title: this.$i18n.t('m.ID'),
            align: 'center',
            type: 'index'
          },
          {
            title: this.$i18n.t('m.Status'),
            align: 'center',
            render: (h, params) => {
              return h('Tag', {
                props: {
                  color: JUDGE_STATUS[params.row.result].color
                }
              }, this.$i18n.t('m.' + JUDGE_STATUS[params.row.result].name.replace(/ /g, '_')))
            }
          },
          {
            title: this.$i18n.t('m.Memory'),
            align: 'center',
            render: (h, params) => {
              return h('span', utils.submissionMemoryFormat(params.row.memory))
            }
          },
          {
            title: this.$i18n.t('m.Time'),
            align: 'center',
            render: (h, params) => {
              return h('span', utils.submissionTimeFormat(params.row.cpu_time))
            }
          }
        ],
        submission: {
          result: '0',
          code: '',
          info: {
            data: []
          },
          statistic_info: {
            time_cost: '',
            memory_cost: ''
          }
        },
        isConcat: false,
        loading: false
      }
    },
    mounted () {
      this.getSubmission()
    },
    methods: {
      getSubmission () {
        this.loading = true
        api.getSubmission(this.$route.params.id).then(res => {
          this.loading = false
          let data = res.data.data
          if (data.info && data.info.data && !this.isConcat) {
            // score exist means the submission is OI problem submission
            if (data.info.data[0].score !== undefined) {
              this.isConcat = true
              const scoreColumn = {
                title: this.$i18n.t('m.Score'),
                align: 'center',
                key: 'score'
              }
              this.columns.push(scoreColumn)
              this.loadingTable = false
            }
            if (this.isAdminRole) {
              this.isConcat = true
              const adminColumn = [
                {
                  title: this.$i18n.t('m.Real_Time'),
                  align: 'center',
                  render: (h, params) => {
                    return h('span', utils.submissionTimeFormat(params.row.real_time))
                  }
                },
                {
                  title: this.$i18n.t('m.Signal'),
                  align: 'center',
                  key: 'signal'
                }
              ]
              this.columns = this.columns.concat(adminColumn)
            }
          }
          this.submission = data
          // 仅WA + 非考试模式时获取助教分析，非阻塞
          if (data.result === -1 && data.problem && !data.contest_is_exam) {
            this.fetchCoachReport(data.username, data.problem)
          }
        }, () => {
          this.loading = false
        })
      },
      fetchCoachReport (username, problemId) {
        axios.get('/coach/reports/' + username + '/' + problemId, {baseURL: '', timeout: 5000})
          .then(res => {
            console.log('Coach report loaded:', res.data)
            if (res.data && res.data.code_analysis) {
              this.coachReport = res.data
              console.log('Coach report set to component data')
            }
          })
          .catch(() => {
            // 无报告或请求失败 → 不显示，零影响
            this.coachReport = null
          })
      },
      shareSubmission (shared) {
        let data = {id: this.submission.id, shared: shared}
        api.updateSubmission(data).then(res => {
          this.getSubmission()
          this.$success(this.$i18n.t('m.Succeeded'))
        }, () => {
        })
      }
    },
    computed: {
      status () {
        return {
          type: JUDGE_STATUS[this.submission.result].type,
          statusName: JUDGE_STATUS[this.submission.result].name,
          color: JUDGE_STATUS[this.submission.result].color
        }
      },
      isCE () {
        return this.submission.result === -2
      },
      isAdminRole () {
        return this.$store.getters.isAdminRole
      }
    }
  }
</script>

<style scoped lang="less">
  #status {
    .title {
      font-size: 20px;
    }
    .content {
      margin-top: 10px;
      font-size: 14px;
      span {
        margin-right: 10px;
      }
      pre {
        white-space: pre-wrap;
        word-wrap: break-word;
        word-break: break-all;
      }
    }
  }

  .admin-info {
    margin: 5px 0;
    &-content {
      font-size: 16px;
      padding: 10px;
    }
  }

  #share-btn {
    float: right;
    margin-top: 5px;
    margin-right: 10px;
  }

  pre {
    border: none;
    background: none;
  }
</style>
