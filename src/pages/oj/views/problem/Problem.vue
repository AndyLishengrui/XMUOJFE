<template>
  <div class="flex-container">
    <div id="problem-main">
      <!--problem main-->
      <Panel :padding="40" shadow>
        <div slot="title">{{problem.title}}</div>
        <div id="problem-content" class="markdown-body" v-katex>
          <p class="title">{{$t('m.Description')}}</p>
          <p class="content" v-html=problem.description></p>
          <!-- {{$t('m.music')}} -->
          <p class="title">{{$t('m.Input')}} <span v-if="problem.io_mode.io_mode=='File IO'">({{$t('m.FromFile')}}: {{ problem.io_mode.input }})</span></p>
          <p class="content" v-html=problem.input_description></p>

          <p class="title">{{$t('m.Output')}} <span v-if="problem.io_mode.io_mode=='File IO'">({{$t('m.ToFile')}}: {{ problem.io_mode.output }})</span></p>
          <p class="content" v-html=problem.output_description></p>

          <div v-for="(sample, index) of problem.samples" :key="index">
            <div class="flex-container sample">
              <div class="sample-input">
                <p class="title">{{$t('m.Sample_Input')}} {{index + 1}}
                  <a class="copy"
                     v-clipboard:copy="sample.input"
                     v-clipboard:success="onCopy"
                     v-clipboard:error="onCopyError">
                    <Icon type="clipboard"></Icon>
                  </a>
                </p>
                <pre>{{sample.input}}</pre>
              </div>
              <div class="sample-output">
                <p class="title">{{$t('m.Sample_Output')}} {{index + 1}}</p>
                <pre>{{sample.output}}</pre>
              </div>
            </div>
          </div>

          <div v-if="problem.hint">
            <p class="title">{{$t('m.Hint')}}</p>
            <Card dis-hover>
              <div class="content" v-html=problem.hint></div>
            </Card>
          </div>

          <div v-if="problem.source">
            <p class="title">{{$t('m.Source')}}</p>
            <p class="content">{{problem.source}}</p>
          </div>

          <div v-if="problem.can_download_test_case">
            <p class="title" key="info1">{{$t('m.TestCase_Download_Title')}}</p>
            <p class="content" key="info2">{{$t('m.TestCase_Download_Description')}}
              <Button type="ghost" @click="downloadTestCase(problem.id)">{{$t('m.TestCase_Download_Button')}}</Button>
            </p>
          </div>

        </div>
      </Panel>
      <!--problem main end-->
      <Card :padding="20" id="submit-code" dis-hover>
        <MonacoEditor :value.sync="code"
                      :languages="problem.languages"
                      :language="language"
                      :theme="theme"
                      :enableTemplates="enableTemplates"
                      @resetCode="onResetToTemplate"
                      @changeTheme="onChangeTheme"
                      @changeLang="onChangeLang"
                      @debug="onDebug"
                      @submit="submitCode"
                      @save="onSaveCode"></MonacoEditor>

        <!-- Debug Panel -->
        <div class="debug-panel-section">
          <div class="debug-input-area">
            <span class="debug-label">输入</span>
            <Input v-model="debugInput" type="textarea" :rows="3" placeholder="输入测试数据（默认使用题目样例）" />
          </div>
          <!-- Debug Results -->
          <div v-if="debugResult" class="debug-results-panel">
            <div class="debug-results-header">
              <Icon type="ios-play" size="16" />
              <span>运行结果</span>
              <span class="debug-meta-inline">{{ debugResult.time_cost }}ms</span>
            </div>
            <div class="debug-results-body">
              <pre class="debug-io">{{ debugResult.output }}</pre>
            </div>
          </div>
        </div>

        <!-- Test Results Panel -->
        <div v-if="testResults.length" class="test-results-panel">
          <div class="test-results-header">
            <Icon type="ios-checkmark" size="18" />
            <span>样例测试结果</span>
          </div>
          <div class="test-results-body">
            <div v-for="(result, index) in testResults" :key="index" class="test-result-item">
              <div class="test-result-status" :class="{ 'ac': result.passed, 'wa': !result.passed }">
                {{ result.passed ? 'AC' : 'WA' }}
              </div>
              <div class="test-result-content">
                <div class="test-result-label">样例 {{ index + 1 }}</div>
                <div v-if="!result.passed" class="test-result-diff">
                  <div class="diff-item">
                    <span class="diff-label">期望:</span>
                    <pre class="diff-value expected">{{ result.expected }}</pre>
                  </div>
                  <div class="diff-item">
                    <span class="diff-label">实际:</span>
                    <pre class="diff-value actual">{{ result.actual }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Submit Status -->
        <Row type="flex" justify="space-between" style="margin-top: 15px">
          <Col :span="10">
            <div class="status" v-if="statusVisible">
              <template v-if="!this.contestID || (this.contestID && OIContestRealTimePermission)">
                <span>{{$t('m.Status')}}</span>
                <Tag type="dot" :color="submissionStatus.color" @click.native="handleRoute('/status/'+submissionId)">
                  {{$t('m.' + submissionStatus.text.replace(/ /g, "_"))}}
                </Tag>
                <span> [ <Icon type="arrow-left-a"></Icon> 点击左侧按钮，查看详情 ]</span>
              </template>
              <template v-else-if="this.contestID && !OIContestRealTimePermission">
                <Alert type="success" show-icon>
                  {{$t('m.Submitted_successfully')}}
                  <a style="margin-left: 8px;" @click="handleRoute(submissionRoute)">查看我的提交</a>
                </Alert>
              </template>
            </div>
            <div v-else-if="problem.my_status === 0">
              <Alert type="success" show-icon>{{$t('m.You_have_solved_the_problem')}}</Alert>
            </div>
            <div v-else-if="this.contestID && !OIContestRealTimePermission && submissionExists">
              <Alert type="success" show-icon>
                {{$t('m.You_have_submitted_a_solution')}}
                <a style="margin-left: 8px;" @click="handleRoute(submissionRoute)">查看我的提交</a>
              </Alert>
            </div>
            <div v-if="contestEnded">
              <Alert type="warning" show-icon>{{$t('m.Contest_has_ended')}}</Alert>
            </div>
          </Col>

          <Col :span="12">
            <template v-if="captchaRequired">
              <div class="captcha-container">
                <Tooltip v-if="captchaRequired" content="Click to refresh" placement="top">
                  <img :src="captchaSrc" @click="getCaptchaSrc"/>
                </Tooltip>
                <Input v-model="captchaCode" class="captcha-code"/>
              </div>
            </template>
            <div class="fl-right">
              <Button type="primary" icon="play" @click="onDebug()"
                      :disabled="problemSubmitDisabled || submitted"
                      style="margin-right: 8px">
                调试代码
              </Button>
              <Button type="warning" icon="edit" :loading="submitting" @click="submitCode"
                      :disabled="problemSubmitDisabled || submitted">
                <span v-if="submitting">{{$t('m.Submitting')}}</span>
                <span v-else>提交代码</span>
              </Button>
            </div>
          </Col>
        </Row>
      </Card>
    </div>

    <div id="right-column">
      <VerticalMenu @on-click="handleRoute">
        <template v-if="this.contestID">
          <VerticalMenu-item :route="{name: 'contest-problem-list', params: {contestID: contestID}}">
            <Icon type="ios-photos"></Icon>
            {{$t('m.Problems')}}
          </VerticalMenu-item>

          <VerticalMenu-item :route="{name: 'contest-announcement-list', params: {contestID: contestID}}">
            <Icon type="chatbubble-working"></Icon>
            {{$t('m.Announcements')}}
          </VerticalMenu-item>
        </template>

          <VerticalMenu-item :route="submissionRoute">
          <Icon type="navicon-round"></Icon>
            {{ this.contestID && !OIContestRealTimePermission ? '我的提交' : $t('m.Submissions') }}
        </VerticalMenu-item>

        <template v-if="this.contestID">
          <VerticalMenu-item v-if="canViewContestRank && (!this.contestID || OIContestRealTimePermission)"
                             :route="{name: 'contest-rank', params: {contestID: contestID}}">
            <Icon type="stats-bars"></Icon>
            {{$t('m.Rankings')}}
          </VerticalMenu-item>
          <VerticalMenu-item :route="{name: 'contest-details', params: {contestID: contestID}}">
            <Icon type="home"></Icon>
            {{$t('m.View_Contest')}}
          </VerticalMenu-item>
        </template>
      </VerticalMenu>

      <Card id="info">
        <div slot="title" class="header">
          <Icon type="information-circled"></Icon>
          <span class="card-title">{{$t('m.Information')}}</span>
        </div>
        <ul>
          <li><p>ID</p>
            <p>{{problem._id}}</p></li>
          <li>
            <p>{{$t('m.Time_Limit')}}</p>
            <p>{{problem.time_limit}}MS</p></li>
          <li>
            <p>{{$t('m.Memory_Limit')}}</p>
            <p>{{problem.memory_limit}}MB</p></li>
          <li>
          <li>
            <p>{{$t('m.IOMode')}}</p>
            <p>{{problem.io_mode.io_mode}}</p>
          </li>
          <li>
            <p>{{$t('m.Created')}}</p>
            <p>{{problem.created_by.username}}</p></li>
          <li v-if="problem.difficulty">
            <p>{{$t('m.Level')}}</p>
            <p>{{$t('m.' + problem.difficulty)}}</p></li>
          <li v-if="problem.total_score">
            <p>{{$t('m.Score')}}</p>
            <p>{{problem.total_score}}</p>
          </li>
          <li>
            <p>{{$t('m.Tags')}}</p>
            <p>
              <Poptip trigger="hover" placement="left-end">
                <a>{{$t('m.Show')}}</a>
                <div slot="content">
                  <Tag v-for="tag in problem.tags" :key="tag">{{tag}}</Tag>
                </div>
              </Poptip>
            </p>
          </li>
        </ul>
      </Card>

      <Card id="pieChart" :padding="0" v-if="!this.contestID || OIContestRealTimePermission">
        <div slot="title">
          <Icon type="ios-analytics"></Icon>
          <span class="card-title">{{$t('m.Statistic')}}</span>
          <Button type="ghost" size="small" id="detail" @click="graphVisible = !graphVisible">{{$t('m.Details')}}</Button>
        </div>
        <div class="echarts">
          <ECharts :options="pie"></ECharts>
        </div>
      </Card>
    </div>

    <Modal v-model="graphVisible">
      <div id="pieChart-detail">
        <ECharts :options="largePie" :initOptions="largePieInitOpts"></ECharts>
      </div>
      <div slot="footer">
        <Button type="ghost" @click="graphVisible=false">{{$t('m.Close')}}</Button>
      </div>
    </Modal>
  </div>
</template>

<script>
  import {mapGetters, mapActions} from 'vuex'
  import {types} from '../../../../store'
  import MonacoEditor from '@oj/components/MonacoEditor.vue'
  import storage from '@/utils/storage'
  import {FormMixin} from '@oj/components/mixins'
  import {JUDGE_STATUS, CONTEST_STATUS, buildProblemCodeKey} from '@/utils/constants'
  import api from '@oj/api'
  import {pie, largePie} from './chartData'
  import utils from '@/utils/utils'

  // 只显示这些状态的图形占用
  const filtedStatus = ['-1', '-2', '0', '1', '2', '3', '4', '8']

  export default {
    name: 'Problem',
    components: {
      MonacoEditor
    },
    mixins: [FormMixin],
    data () {
      return {
        statusVisible: false,
        captchaRequired: false,
        graphVisible: false,
        submissionExists: false,
        captchaCode: '',
        captchaSrc: '',
        contestID: '',
        problemID: '',
        submitting: false,
        code: '',
        language: 'C++',
        theme: 'vs',
        submissionId: '',
        submitted: false,
        testResults: [],
        runningTests: false,
        debugResult: null,
        debugInput: '',
        debugStatus: '',
        editorSettings: {
          theme: 'vs',
          fontSize: 14,
          tabSize: 4,
          keymap: 'standard',
          completion: 'basic'
        },
        result: {
          result: 9
        },
        problem: {
          title: '',
          description: '',
          hint: '',
          my_status: '',
          template: {},
          languages: [],
          created_by: {
            username: ''
          },
          tags: [],
          io_mode: {'io_mode': 'Standard IO'}
        },
        pie: pie,
        largePie: largePie,
        // echarts 无法获取隐藏dom的大小，需手动指定
        largePieInitOpts: {
          width: '500',
          height: '440'
        }
      }
    },
    beforeRouteEnter (to, from, next) {
      let problemCode = storage.get(buildProblemCodeKey(to.params.problemID, to.params.contestID))
      if (problemCode) {
        next(vm => {
          vm.language = problemCode.language
          vm.code = problemCode.code
          vm.theme = problemCode.theme
        })
      } else {
        next()
      }
    },
    mounted () {
      this.$store.commit(types.CHANGE_CONTEST_ITEM_VISIBLE, {menu: false})
      this.init()
    },
    methods: {
      ...mapActions(['changeDomTitle']),
      init () {
        this.$Loading.start()
        this.contestID = this.$route.params.contestID
        this.problemID = this.$route.params.problemID
        let func = this.$route.name === 'problem-details' ? 'getProblem' : 'getContestProblem'
        api[func](this.problemID, this.contestID).then(res => {
          this.$Loading.finish()
          let problem = res.data.data
          this.changeDomTitle({title: problem.title})
          api.submissionExists(problem.id, this.contestID).then(res => {
            this.submissionExists = res.data.data
          })
          problem.languages = problem.languages.sort().filter(l => l !== 'Python2')
          this.problem = problem
          // Init debug input with first sample
          if (problem.samples && problem.samples.length) {
            this.debugInput = problem.samples[0].input || ''
          }
          if (problem.statistic_info) {
            this.changePie(problem)
          }

          // 在beforeRouteEnter中修改了, 说明本地有code，无需加载template
          if (this.code !== '') {
            return
          }
          // try to load problem template
          // Prefer C++ over C as default language
          const langs = this.problem.languages
          this.language = langs.includes('C++') ? 'C++' : langs[0]
          let template = this.problem.template
          if (template && template[this.language]) {
            this.code = template[this.language]
          }
        }, () => {
          this.$Loading.error()
        })
      },
      changePie (problemData) {
        // 只显示特定的一些状态
        for (let k in problemData.statistic_info) {
          if (filtedStatus.indexOf(k) === -1) {
            delete problemData.statistic_info[k]
          }
        }
        let acNum = problemData.accepted_number
        let data = [
          {name: this.$i18n.t('m.Short_Wrong_Answer'), value: problemData.submission_number - acNum},
          {name: this.$i18n.t('m.Short_Accepted'), value: acNum}
        ]
        this.pie.series[0].data = data
        this.pie.legend.data = [this.$i18n.t('m.Short_Accepted'), this.$i18n.t('m.Short_Wrong_Answer')]
        // 只把大图的AC selected下，这里需要做一下deepcopy
        let data2 = JSON.parse(JSON.stringify(data))
        data2[1].selected = true
        this.largePie.series[1].data = data2

        // 根据结果设置legend,没有提交过的legend不显示
        let legend = Object.keys(problemData.statistic_info).map(ele => this.$i18n.t(JUDGE_STATUS[ele].short))
        if (legend.length === 0) {
          legend.push(this.$i18n.t('m.Short_Accepted'), this.$i18n.t('m.Short_Wrong_Answer'))
        }
        this.largePie.legend.data = legend

        // 把ac的数据提取出来放在最后
        let acCount = problemData.statistic_info['0']
        delete problemData.statistic_info['0']

        let largePieData = []
        Object.keys(problemData.statistic_info).forEach(ele => {
          largePieData.push({name: this.$i18n.t(JUDGE_STATUS[ele].short), value: problemData.statistic_info[ele]})
        })
        largePieData.push({name: this.$i18n.t('m.Short_Accepted'), value: acCount})
        this.largePie.series[0].data = largePieData
      },
      handleRoute (route) {
        this.$router.push(route)
      },
      onChangeLang (newLang) {
        if (this.problem.template[newLang]) {
          if (this.code.trim() === '') {
            this.code = this.problem.template[newLang]
          }
        }
        this.language = newLang
      },
      onChangeTheme (newTheme) {
        this.theme = newTheme
      },
      onResetToTemplate () {
        this.$Modal.confirm({
          content: this.$i18n.t('m.Are_you_sure_you_want_to_reset_your_code'),
          onOk: () => {
            let template = this.problem.template
            if (template && template[this.language]) {
              this.code = template[this.language]
            } else {
              this.code = ''
            }
          }
        })
      },
      onRunTests () {
        if (!this.problem.samples || !this.problem.samples.length) {
          this.$Message.warning('本题没有样例数据')
          return
        }
        if (!this.code.trim()) {
          this.$Message.warning('代码为空，请先编写代码')
          return
        }
        this.runningTests = true
        this.testResults = []

        // Simulate test execution (client-side comparison)
        // In a real implementation, this would call a local runner or sandbox API
        setTimeout(() => {
          this.testResults = this.problem.samples.map((sample, index) => {
            // For now, just show the samples with a placeholder result
            // Real test execution would require a backend sandbox
            return {
              passed: false,
              expected: sample.output,
              actual: '(本地测试暂未实现，请提交后查看结果)',
              input: sample.input
            }
          })
          this.runningTests = false
        }, 500)
      },
      onDebug (input) {
        if (!this.code.trim()) {
          this.$Message.warning('代码为空，请先编写代码')
          return
        }
        // Only use input from MonacoEditor's internal debug panel (when @debug emits a value)
        // Otherwise keep whatever the user typed in the textarea
        if (input !== undefined) {
          this.debugInput = input
        }
        // Fallback to first sample if still empty
        if (!this.debugInput && this.problem.samples && this.problem.samples.length) {
          this.debugInput = this.problem.samples[0].input || ''
        }
        this.debugResult = null
        this.debugStatus = 'Running...'

        api.runCode({
          problem_id: this.problem.id,
          language: this.language,
          code: this.code,
          input: this.debugInput,
          contest_id: this.contestID || undefined
        }).then(res => {
          this.debugResult = res.data.data
          this.debugStatus = 'Finished'
        }).catch(err => {
          this.debugStatus = 'Error'
          const msg = (err && err.data && err.data.data) ? err.data.data : '运行失败'
          this.$Message.error(msg)
          this.debugResult = { output: msg, time_cost: 0, memory_cost: 0 }
        })
      },
      onSaveCode () {
        this.$Message.success('代码已保存到本地')
      },
      checkSubmissionStatus () {
        // 使用setTimeout避免一些问题
        if (this.refreshStatus) {
          // 如果之前的提交状态检查还没有停止,则停止,否则将会失去timeout的引用造成无限请求
          clearTimeout(this.refreshStatus)
        }
        const checkStatus = () => {
          let id = this.submissionId
          api.getSubmission(id).then(res => {
            this.result = res.data.data
            if (Object.keys(res.data.data.statistic_info).length !== 0) {
              this.submitting = false
              this.submitted = false
              clearTimeout(this.refreshStatus)
              this.init()
            } else {
              this.refreshStatus = setTimeout(checkStatus, 2000)
            }
          }, res => {
            this.submitting = false
            clearTimeout(this.refreshStatus)
          })
        }
        this.refreshStatus = setTimeout(checkStatus, 2000)
      },
      submitCode () {
        if (this.code.trim() === '') {
          this.$error(this.$i18n.t('m.Code_can_not_be_empty'))
          return
        }
        this.submissionId = ''
        this.result = {result: 9}
        this.submitting = true
        let data = {
          problem_id: this.problem.id,
          language: this.language,
          code: this.code,
          contest_id: this.contestID
        }
        if (this.captchaRequired) {
          data.captcha = this.captchaCode
        }
        const submitFunc = (data, detailsVisible) => {
          this.statusVisible = true
          api.submitCode(data).then(res => {
            this.submissionId = res.data.data && res.data.data.submission_id
            // 定时检查状态
            this.submitting = false
            this.submissionExists = true
            if (!detailsVisible) {
              this.$Modal.success({
                title: this.$i18n.t('m.Success'),
                content: this.$i18n.t('m.Submit_code_successfully')
              })
              return
            }
            this.submitted = true
            this.checkSubmissionStatus()
          }, res => {
            this.getCaptchaSrc()
            if (res.data.data.startsWith('Captcha is required')) {
              this.captchaRequired = true
            } else if (res.data.data.includes('Test case not found')) {
              this.$error('测试用例不存在，请联系管理员')
            }
            this.submitting = false
            this.statusVisible = false
          })
        }

        if (this.contestRuleType === 'OI' && !this.OIContestRealTimePermission) {
          if (this.submissionExists) {
            this.$Modal.confirm({
              title: '',
              content: '<h3>' + this.$i18n.t('m.You_have_submission_in_this_problem_sure_to_cover_it') + '<h3>',
              onOk: () => {
                // 暂时解决对话框与后面提示对话框冲突的问题(否则一闪而过）
                setTimeout(() => {
                  submitFunc(data, false)
                }, 1000)
              },
              onCancel: () => {
                this.submitting = false
              }
            })
          } else {
            submitFunc(data, false)
          }
        } else {
          submitFunc(data, true)
        }
      },
      onCopy (event) {
        this.$success('Code copied')
      },
      onCopyError (e) {
        this.$error('Failed to copy code')
      },
      downloadTestCase (problemID) {
        let url = '/dl_test_case?problem_id=' + problemID
        utils.downloadFile(url)
      }
    },
    computed: {
      ...mapGetters(['problemSubmitDisabled', 'contestRuleType', 'OIContestRealTimePermission', 'contestStatus', 'canViewContestRank', 'isAuthenticated']),
      contest () {
        return this.$store.state.contest.contest
      },
      isExamContest () {
        return this.contest && this.contest.is_exam
      },
      enableTemplates () {
        // Disable template matching for exam contests
        return !this.isExamContest
      },
      contestEnded () {
        return this.contestStatus === CONTEST_STATUS.ENDED
      },
      submissionStatus () {
        return {
          text: JUDGE_STATUS[this.result.result]['name'],
          color: JUDGE_STATUS[this.result.result]['color']
        }
      },
      submissionRoute () {
        if (this.contestID) {
          const query = {problemID: this.problemID}
          if (!this.OIContestRealTimePermission && this.isAuthenticated) {
            query.myself = '1'
          }
          return {name: 'contest-submission-list', query}
        } else {
          return {name: 'submission-list', query: {problemID: this.problemID}}
        }
      }
    },
    beforeRouteLeave (to, from, next) {
      // 防止切换组件后仍然不断请求
      clearInterval(this.refreshStatus)

      this.$store.commit(types.CHANGE_CONTEST_ITEM_VISIBLE, {menu: true})
      storage.set(buildProblemCodeKey(this.problem._id, from.params.contestID), {
        code: this.code,
        language: this.language,
        theme: this.theme
      })
      next()
    },
    watch: {
      '$route' () {
        this.init()
      }
    }
  }
</script>

<style lang="less" scoped>
  .card-title {
    margin-left: 8px;
  }

  .flex-container {
    #problem-main {
      flex: auto;
      margin-right: 18px;
    }
    #right-column {
      flex: none;
      width: 220px;
    }
  }

  #problem-content {
    margin-top: -50px;
    .title {
      font-size: 20px;
      font-weight: 400;
      margin: 25px 0 8px 0;
      color: #3091f2;
      .copy {
        padding-left: 8px;
      }
    }
    p.content {
      margin-left: 25px;
      margin-right: 20px;
      font-size: 15px
    }
    .sample {
      align-items: stretch;
      &-input, &-output {
        width: 50%;
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        margin-right: 5%;
      }
      pre {
        flex: 1 1 auto;
        align-self: stretch;
        border-style: solid;
        background: transparent;
      }
    }
  }

  #submit-code {
    margin-top: 20px;
    margin-bottom: 20px;
    .status {
      float: left;
      span {
        margin-right: 10px;
        margin-left: 10px;
      }
    }
    .captcha-container {
      display: inline-block;
      .captcha-code {
        width: auto;
        margin-top: -20px;
        margin-left: 20px;
      }
    }
  }

  #info {
    margin-bottom: 20px;
    margin-top: 20px;
    ul {
      list-style-type: none;
      li {
        border-bottom: 1px dotted #e9eaec;
        margin-bottom: 10px;
        p {
          display: inline-block;
        }
        p:first-child {
          width: 90px;
        }
        p:last-child {
          float: right;
        }
      }
    }
  }

  .fl-right {
    float: right;
  }

  // Debug panel
  .debug-panel-section {
    margin-top: 10px;

    .debug-input-area {
      margin-bottom: 10px;

      .debug-label {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 4px;
        display: inline-block;
      }
    }
  }

  .debug-results-panel {
    border: 1px solid #e8eaec;
    border-radius: 4px;
    overflow: hidden;

    .debug-results-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: #f8f8f9;
      border-bottom: 1px solid #e8eaec;
      font-weight: 600;
      font-size: 13px;
    }

    .debug-meta-inline {
      margin-left: auto;
      font-weight: 400;
      color: #808695;
      font-size: 12px;
    }

    .debug-results-body {
      .debug-io {
        margin: 0;
        padding: 10px 12px;
        background: #1d1e1f;
        color: #d4d4d4;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 13px;
        max-height: 200px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-all;
        border-radius: 0;
      }
    }
  }

  // Test results panel
  .test-results-panel {
    margin-top: 15px;
    border: 1px solid #e8eaec;
    border-radius: 4px;
    overflow: hidden;

    .test-results-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: #f8f8f9;
      border-bottom: 1px solid #e8eaec;
      font-weight: 600;
      font-size: 13px;
    }

    .test-results-body {
      padding: 10px 12px;
    }

    .test-result-item {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
      padding: 8px;
      border-radius: 4px;
      background: #fafafa;

      &:last-child {
        margin-bottom: 0;
      }
    }

    .test-result-status {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      font-weight: 700;
      font-size: 12px;

      &.ac {
        background: #edfff3;
        color: #19be6b;
      }

      &.wa {
        background: #ffeef0;
        color: #ed4014;
      }
    }

    .test-result-content {
      flex: 1;
    }

    .test-result-label {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .test-result-diff {
      .diff-item {
        margin-bottom: 4px;

        .diff-label {
          font-size: 12px;
          color: #808695;
        }

        .diff-value {
          margin-top: 2px;
          padding: 6px 8px;
          border-radius: 3px;
          font-size: 12px;
          overflow-x: auto;

          &.expected {
            background: #edfff3;
            color: #19be6b;
          }

          &.actual {
            background: #ffeef0;
            color: #ed4014;
          }
        }
      }
    }
  }

  #pieChart {
    .echarts {
      height: 250px;
      width: 210px;
    }
    #detail {
      position: absolute;
      right: 10px;
      top: 10px;
    }
  }

  #pieChart-detail {
    margin-top: 20px;
    width: 500px;
    height: 440px;
  }
</style>

