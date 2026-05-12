<template>
  <div class="uh-page">
    <div class="uh-layout">

      <!-- 左侧个人信息栏 -->
      <div class="uh-sidebar">
        <div class="uh-avatar-wrap">
          <img class="uh-avatar" :src="profile.avatar || '/public/avatar/default.png'" />
        </div>
        <div v-if="profile.user">
          <p class="uh-username">{{ profile.user.username }}</p>
          <p class="uh-school" v-if="profile.school">{{ profile.school }}</p>
          <p class="uh-mood" v-if="profile.mood">{{ profile.mood }}</p>
          <div class="uh-stats">
            <div class="uh-stat-item">
              <div class="uh-stat-num">{{ profile.accepted_number }}</div>
              <div class="uh-stat-label">已解决</div>
            </div>
            <div class="uh-stat-divider"></div>
            <div class="uh-stat-item">
              <div class="uh-stat-num">{{ profile.submission_number }}</div>
              <div class="uh-stat-label">提交数</div>
            </div>
            <div class="uh-stat-divider"></div>
            <div class="uh-stat-item">
              <div class="uh-stat-num">{{ profile.total_score }}</div>
              <div class="uh-stat-label">总分</div>
            </div>
          </div>
          <div class="uh-social">
            <a v-if="profile.github" :href="profile.github" target="_blank" class="uh-social-link">
              <Icon type="social-github-outline" size="20"></Icon>
            </a>
            <a v-if="profile.user.email" :href="'mailto:' + profile.user.email" class="uh-social-link">
              <Icon type="ios-email-outline" size="20"></Icon>
            </a>
            <a v-if="profile.blog" :href="profile.blog" target="_blank" class="uh-social-link">
              <Icon type="ios-world-outline" size="20"></Icon>
            </a>
          </div>
          <div class="uh-refresh-wrap" v-if="refreshVisible">
            <Poptip trigger="hover" placement="right-start">
              <a class="uh-refresh-link"><Icon type="ios-refresh"></Icon> 刷新题目 ID</a>
              <div slot="content">
                <p>如果题号不存在，可点击重新生成。</p>
                <Button type="info" size="small" @click="freshProblemDisplayID">重新生成</Button>
              </div>
            </Poptip>
          </div>
        </div>
      </div>

      <!-- 右侧主内容区 -->
      <div class="uh-main">
        <Tabs v-model="activeTab" class="uh-tabs">

          <!-- Tab: 已解决题目 -->
          <TabPane label="已解决题目" name="problems">
            <div class="uh-tab-body" v-if="profile.user">
              <div v-if="problems.length === 0" class="uh-empty">
                <Icon type="ios-checkmark-circle-outline" size="40" color="#ccc"></Icon>
                <p>暂无已解决的题目</p>
              </div>
              <div v-else>
                <p class="uh-problems-count">共解决 <strong>{{ problems.length }}</strong> 道题目</p>
                <div class="uh-problem-tags">
                  <span
                    v-for="pid of displayedProblems"
                    :key="pid"
                    class="uh-problem-tag"
                    @click="goProblem(pid)"
                  >{{ pid }}</span>
                </div>
                <div class="uh-show-more" v-if="problems.length > showLimit">
                  <Button type="text" @click="toggleShowAll" size="small">
                    {{ showAll ? '收起' : '展开全部 (' + problems.length + ' 道)' }}
                    <Icon :type="showAll ? 'ios-arrow-up' : 'ios-arrow-down'"></Icon>
                  </Button>
                </div>
              </div>
            </div>
          </TabPane>

          <!-- Tab: 参加的实验 -->
          <TabPane label="参加的实验" name="contests">
            <div class="uh-tab-body">
              <div v-if="contestLoading" class="uh-empty">
                <Spin></Spin>
              </div>
              <div v-else-if="contestSummary.total === 0" class="uh-empty">
                <Icon type="ios-trophy-outline" size="40" color="#ccc"></Icon>
                <p>暂无参与实验记录</p>
              </div>
              <div v-else class="uh-contest-list">
                <div
                  v-for="item in contestSummary.results"
                  :key="item.contest_id"
                  class="uh-contest-item"
                >
                  <div class="uh-contest-left">
                    <a class="uh-contest-title" @click="showContestDetail(item.contest_id)">
                      {{ item.contest_title }}
                    </a>
                    <div class="uh-contest-meta">
                      <span class="uh-rule-tag" :class="item.rule_type === 'ACM' ? 'tag-acm' : 'tag-oi'">
                        {{ item.rule_type }}
                      </span>
                      <span class="uh-meta-text" v-if="item.rule_type === 'ACM'">
                        AC {{ item.ac_count }} 题 · 提交 {{ item.submission_count }} 次
                      </span>
                      <span class="uh-meta-text" v-else>
                        得分 {{ item.total_score }} · 提交 {{ item.submission_count }} 次
                      </span>
                    </div>
                  </div>
                  <div class="uh-contest-right">
                    <span class="uh-rank-badge" v-if="item.my_rank">排名：{{ item.my_rank }}</span>
                    <span class="uh-rank-badge uh-rank-none" v-else>-</span>
                    <span class="uh-contest-date">{{ formatTime(item.end_time) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </TabPane>

        </Tabs>
      </div>

    </div>

    <!-- 实验详情弹窗 -->
    <Modal
      v-model="contestDetailVisible"
      width="820"
      :footer-hide="true"
    >
      <div slot="header" class="uh-modal-header">
        <span>实验详情</span>
        <Button 
          v-if="contestDetail && !contestDetailLoading" 
          type="text" 
          size="small" 
          @click="calibrateContest(contestDetail.contest_id)"
          :loading="calibrateLoading"
          class="uh-refresh-btn"
        >
          <Icon type="ios-refresh"></Icon> 刷新数据
        </Button>
      </div>
      <div v-if="contestDetailLoading" style="text-align:center;padding:40px 0;">
        <Spin></Spin>
      </div>
      <div v-else-if="contestDetail">
        <div class="uh-detail-header">
          <span class="uh-detail-title">{{ contestDetail.contest_title }}</span>
          <span class="uh-rule-tag" :class="contestDetail.rule_type === 'ACM' ? 'tag-acm' : 'tag-oi'" style="margin-left:10px;">
            {{ contestDetail.rule_type }}
          </span>
          <span v-if="contestDetail.my_rank" class="uh-detail-rank">排名 #{{ contestDetail.my_rank }}</span>
        </div>
        <div class="uh-detail-stats">
          <span v-if="contestDetail.rule_type === 'ACM'">AC {{ contestDetail.ac_count }} 题</span>
          <span v-else>得分 {{ contestDetail.total_score }}</span>
          <span style="margin-left:16px;">共提交 {{ contestDetail.submission_count }} 次</span>
        </div>
        <Table
          :columns="contestDetailColumns"
          :data="contestDetail.problem_items || []"
          size="small"
          class="uh-detail-table"
        ></Table>
      </div>
    </Modal>
  </div>
</template>
<script>
  import { mapActions } from 'vuex'
  import time from '@/utils/time'
  import api from '@oj/api'

  const SHOW_LIMIT = 30

  export default {
    data () {
      return {
        username: '',
        profile: {},
        problems: [],
        activeTab: 'problems',
        showAll: false,
        showLimit: SHOW_LIMIT,
        contestLoading: false,
        contestDetailLoading: false,
        calibrateLoading: false,
        contestDetailVisible: false,
        contestDetail: null,
        problemContestRouteCache: {},
        contestSummary: {
          total: 0,
          results: []
        },
        contestDetailColumns: [
          {
            title: '题目',
            minWidth: 220,
            render: (h, params) => {
              return h('a', {
                on: {
                  click: () => this.goContestProblem(this.contestDetail.contest_id, params.row.display_id)
                }
              }, `${params.row.display_id} - ${params.row.title}`)
            }
          },
          {
            title: 'AC',
            width: 80,
            render: (h, params) => {
              const color = params.row.is_ac ? '#19be6b' : '#ed4014'
              const text = params.row.is_ac ? '✓' : '✗'
              return h('span', { style: { color, fontWeight: 'bold' } }, text)
            }
          },
          {
            title: '用时 / 得分',
            width: 130,
            render: (h, params) => {
              if (params.row.ac_time !== null && params.row.ac_time !== undefined) {
                const mins = Math.floor(params.row.ac_time / 60)
                const secs = params.row.ac_time % 60
                return h('span', {}, `${mins}:${String(secs).padStart(2, '0')}`)
              }
              if (params.row.best_score !== null && params.row.best_score !== undefined) {
                return h('span', {}, String(params.row.best_score))
              }
              return h('span', { style: { color: '#999' } }, '-')
            }
          },
          {
            title: '错误次数',
            width: 100,
            render: (h, params) => {
              const n = params.row.error_number || 0
              return h('span', { style: { color: n > 0 ? '#ed4014' : '#999' } }, n > 0 ? `+${n}` : '-')
            }
          }
        ]
      }
    },
    computed: {
      displayedProblems () {
        return this.showAll ? this.problems : this.problems.slice(0, this.showLimit)
      },
      refreshVisible () {
        if (!this.username) return true
        if (this.username && this.username === this.$store.getters.user.username) return true
        return false
      }
    },
    mounted () {
      this.init()
    },
    methods: {
      ...mapActions(['changeDomTitle']),
      init () {
        this.username = this.$route.query.username
        api.getUserInfo(this.username).then(res => {
          this.changeDomTitle({ title: res.data.data.user.username })
          this.profile = res.data.data
          this.getSolvedProblems()
          this.getContestSummary()
        })
      },
      getSolvedProblems () {
        const acm = (this.profile.acm_problems_status || {}).problems || {}
        const oi = (this.profile.oi_problems_status || {}).problems || {}
        const solved = []
        for (const map of [acm, oi]) {
          Object.keys(map).forEach(id => {
            if (map[id]['status'] === 0) solved.push(map[id]['_id'])
          })
        }
        solved.sort()
        this.problems = solved
      },
      getContestSummary () {
        this.contestLoading = true
        api.getUserContestSummary(this.username, 0, 100).then(res => {
          this.contestSummary = res.data.data
        }).finally(() => {
          this.contestLoading = false
        })
      },
      showContestDetail (contestID) {
        this.contestDetailVisible = true
        this.contestDetailLoading = true
        this.contestDetail = null
        api.getUserContestDetail(contestID, this.username).then(res => {
          this.contestDetail = res.data.data
        }).finally(() => {
          this.contestDetailLoading = false
        })
      },
      calibrateContest (contestID) {
        this.calibrateLoading = true
        api.calibrateContest(contestID).then(res => {
          this.$success('数据配准成功')
          // Reload contest detail to show updated data
          this.showContestDetail(contestID)
        }).catch(err => {
          this.$error('配准失败：' + (err.data && err.data.data || err.data || '未知错误'))
        }).finally(() => {
          this.calibrateLoading = false
        })
      },
      async goProblem (problemID) {
        const cachedContestID = this.problemContestRouteCache[problemID]
        if (cachedContestID) {
          this.$router.push({ name: 'contest-problem-details', params: { contestID: cachedContestID, problemID } })
          return
        }

        const contests = (this.contestSummary && this.contestSummary.results) || []
        for (const item of contests) {
          try {
            const res = await api.getUserContestDetail(item.contest_id, this.username)
            const problemItems = (res.data && res.data.data && res.data.data.problem_items) || []
            const matched = problemItems.some(p => p.display_id === problemID)
            if (matched) {
              this.problemContestRouteCache[problemID] = item.contest_id
              this.$router.push({ name: 'contest-problem-details', params: { contestID: item.contest_id, problemID } })
              return
            }
          } catch (e) {
            // ignore a single contest detail failure and continue matching.
          }
        }

        this.$router.push({ name: 'problem-details', params: { problemID } })
      },
      goContestProblem (contestID, problemID) {
        this.$router.push({ name: 'contest-problem-details', params: { contestID, problemID } })
      },
      toggleShowAll () {
        this.showAll = !this.showAll
      },
      formatTime (t) {
        return t ? time.utcToLocal(t, 'YYYY-MM-DD') : '-'
      },
      freshProblemDisplayID () {
        api.freshDisplayID().then(res => {
          const data = (res.data && res.data.data) || {}
          const removed = data.removed || 0
          const accepted = data.accepted_number || 0
          const score = data.total_score || 0
          this.$success(`刷新完成：已过滤 ${removed} 个失效题目，已解 ${accepted}，总分 ${score}`)
          this.init()
        })
      }
    },
    watch: {
      '$route' (newVal, oldVal) {
        if (newVal !== oldVal) this.init()
      }
    }
  }
</script>

<style lang="less" scoped>
  .uh-page {
    background: #f4f5f7;
    min-height: calc(100vh - 60px);
    padding: 32px 0 60px;
  }

  .uh-layout {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 16px;
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }

  /* ── 左侧栏 ── */
  .uh-sidebar {
    flex: 0 0 240px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
    padding: 32px 20px 24px;
    text-align: center;
  }

  .uh-avatar-wrap {
    margin-bottom: 16px;
  }

  .uh-avatar {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 2px 8px rgba(0,0,0,.15);
  }

  .uh-username {
    font-size: 18px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0 0 4px;
  }

  .uh-school {
    font-size: 13px;
    color: #666;
    margin: 0 0 4px;
  }

  .uh-mood {
    font-size: 12px;
    color: #999;
    margin: 0 0 16px;
    font-style: italic;
  }

  .uh-stats {
    display: flex;
    justify-content: center;
    align-items: stretch;
    border-top: 1px solid #f0f0f0;
    border-bottom: 1px solid #f0f0f0;
    padding: 14px 0;
    margin: 16px 0;
    gap: 0;
  }

  .uh-stat-item {
    flex: 1;
  }

  .uh-stat-divider {
    width: 1px;
    background: #e8e8e8;
    margin: 4px 0;
  }

  .uh-stat-num {
    font-size: 20px;
    font-weight: 700;
    color: #262626;
    line-height: 1.3;
  }

  .uh-stat-label {
    font-size: 11px;
    color: #999;
    margin-top: 2px;
  }

  .uh-social {
    display: flex;
    justify-content: center;
    gap: 14px;
    margin-top: 16px;
  }

  .uh-social-link {
    color: #666;
    transition: color .2s;
    &:hover { color: #2d8cf0; }
  }

  .uh-refresh-wrap {
    margin-top: 14px;
    font-size: 12px;
    .uh-refresh-link {
      color: #999;
      cursor: pointer;
      &:hover { color: #2d8cf0; }
    }
  }

  /* ── 右侧主内容 ── */
  .uh-main {
    flex: 1;
    min-width: 0;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
  }

  .uh-tabs {
    /deep/ .ivu-tabs-nav-scroll {
      padding: 0 20px;
    }
    /deep/ .ivu-tabs-bar {
      margin-bottom: 0;
      border-bottom: 1px solid #f0f0f0;
    }
  }

  .uh-tab-body {
    padding: 24px 24px 28px;
    min-height: 200px;
  }

  /* ── 空态 ── */
  .uh-empty {
    text-align: center;
    padding: 60px 0;
    color: #bbb;
    p { margin-top: 10px; font-size: 14px; }
  }

  /* ── 题目标签云 ── */
  .uh-problems-count {
    font-size: 13px;
    color: #666;
    margin-bottom: 14px;
    strong { color: #262626; }
  }

  .uh-problem-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .uh-problem-tag {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    background: #e8f4ff;
    color: #2d8cf0;
    font-size: 12px;
    cursor: pointer;
    transition: background .15s, color .15s;
    &:hover {
      background: #2d8cf0;
      color: #fff;
    }
  }

  .uh-show-more {
    margin-top: 14px;
    text-align: center;
  }

  /* ── 实验列表 ── */
  .uh-contest-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .uh-contest-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid #f5f5f5;
    &:last-child { border-bottom: none; }
  }

  .uh-contest-left {
    flex: 1;
    min-width: 0;
  }

  .uh-contest-title {
    font-size: 15px;
    font-weight: 500;
    color: #2d8cf0;
    cursor: pointer;
    display: block;
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    &:hover { text-decoration: underline; }
  }

  .uh-contest-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .uh-rule-tag {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    &.tag-acm {
      background: #e8f4ff;
      color: #2d8cf0;
    }
    &.tag-oi {
      background: #fff7e6;
      color: #fa8c16;
    }
  }

  .uh-meta-text {
    font-size: 12px;
    color: #999;
  }

  .uh-contest-right {
    flex: 0 0 auto;
    text-align: right;
    margin-left: 20px;
  }

  .uh-rank-badge {
    display: inline-block;
    background: #19be6b;
    color: #fff;
    padding: 2px 10px;
    border-radius: 3px;
    font-size: 12px;
    font-weight: 600;
    &.uh-rank-none {
      background: #e8e8e8;
      color: #aaa;
    }
  }

  .uh-contest-date {
    display: block;
    font-size: 11px;
    color: #bbb;
    margin-top: 4px;
  }

  /* ── 详情弹窗 ── */
  .uh-detail-header {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .uh-detail-title {
    font-size: 16px;
    font-weight: 600;
    color: #262626;
  }

  .uh-detail-rank {
    margin-left: auto;
    background: #19be6b;
    color: #fff;
    padding: 2px 12px;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 600;
  }

  .uh-detail-stats {
    font-size: 13px;
    color: #666;
    margin-bottom: 14px;
  }

  .uh-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 16px;
    font-weight: 600;
  }

  .uh-refresh-btn {
    font-size: 12px;
    padding: 0 !important;
    height: auto !important;
    &:hover {
      color: #2d8cf0 !important;
    }
  }

  .uh-detail-table {
    /deep/ a { color: #2d8cf0; cursor: pointer; }
  }
</style>
