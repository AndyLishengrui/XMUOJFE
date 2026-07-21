<template>
  <div class="cp-wrap">
    <div class="cp-topbar">
      <a @click="goBack" class="cp-back">← 返回教材</a>
      <span class="cp-divider">|</span>
      <span class="cp-course-name">{{ courseTitle }}</span>
    </div>

    <div v-if="loading" class="cp-loading">
      <Spin size="large"/>
      <p>加载题目中...</p>
    </div>

    <div v-else-if="!problem._id" class="cp-empty">
      <p>题目不存在或无权访问</p>
      <a @click="goBack">返回教材</a>
    </div>

    <div v-else class="cp-main">
      <div class="cp-left">
        <Panel shadow>
          <div slot="title">{{ problem._id }} — {{ problem.title }}</div>
          <div class="cp-content">
            <div v-if="problem.description">
              <h4>描述</h4>
              <div v-html="problem.description"></div>
            </div>
            <div v-if="problem.input_description">
              <h4>输入</h4>
              <div v-html="problem.input_description"></div>
            </div>
            <div v-if="problem.output_description">
              <h4>输出</h4>
              <div v-html="problem.output_description"></div>
            </div>
            <div v-if="problem.samples && problem.samples.length">
              <h4>样例</h4>
              <div v-for="(s,i) in problem.samples" :key="i" class="cp-sample">
                <div><span>输入{{i+1}}</span><pre>{{s.input}}</pre></div>
                <div><span>输出{{i+1}}</span><pre>{{s.output}}</pre></div>
              </div>
            </div>
            <div v-if="problem.hint">
              <h4>提示</h4>
              <div v-html="problem.hint"></div>
            </div>
          </div>
        </Panel>
      </div>

      <div class="cp-right">
        <Panel shadow>
          <div slot="title">信息</div>
          <div class="cp-info-item"><span>ID</span><span>{{ problem._id }}</span></div>
          <div class="cp-info-item"><span>时间限制</span><span>{{ problem.time_limit }}MS</span></div>
          <div class="cp-info-item"><span>内存限制</span><span>{{ problem.memory_limit }}MB</span></div>
          <div class="cp-info-item" v-if="problem.difficulty"><span>难度</span><Tag :color="diffColor" size="small">{{ problem.difficulty }}</Tag></div>
          <div class="cp-info-item" v-if="problem.total_score != null"><span>分数</span><span>{{ problem.total_score }}</span></div>
          <div class="cp-info-item" v-if="problem.source"><span>来源</span><span style="font-size:12px">{{ problem.source }}</span></div>
        </Panel>

        <Panel shadow style="margin-top:12px">
          <div slot="title">统计</div>
          <div class="cp-stats">
            <div><b>{{ problem.submission_number || 0 }}</b><span>提交</span></div>
            <div><b>{{ problem.accepted_number || 0 }}</b><span>通过</span></div>
            <div v-if="problem.my_status === 0" style="color:#19be6b"><b>✓</b><span>已AC</span></div>
          </div>
        </Panel>
      </div>
    </div>

    <div v-if="problem._id" class="cp-submit-wrap">
      <Panel shadow>
        <div slot="title">提交代码</div>
        <div class="cp-toolbar">
          <span>语言:</span>
          <Select v-model="language" size="small" style="width:130px">
            <Option v-for="l in problem.languages" :key="l" :value="l">{{l}}</Option>
          </Select>
          <Button type="primary" size="small" @click="submitCode" :loading="submitting">提交</Button>
        </div>
        <textarea v-model="code" class="cp-editor" spellcheck="false"
          placeholder="// 在此输入代码..."></textarea>
      </Panel>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
export default {
  name: 'CourseProblem',
  data() {
    return {
      courseId: null, courseTitle: '', contestId: null,
      problem: {}, code: '', language: 'C++', loading: true, submitting: false
    }
  },
  mounted() {
    this.courseId = this.$route.params.courseId
    this.problemID = this.$route.params.problemID
    axios.get('/course/detail/?id=' + this.courseId).then(res => {
      if (!res.data.error) {
        const d = res.data.data
        this.courseTitle = d.title
        this.contestId = d.contest_id
      }
      this.loadProblem()
    })
  },
  methods: {
    goBack() { this.$router.push({name:'course-detail',params:{courseId:this.courseId}}) },
    loadProblem() {
      this.loading = true
      const url = this.contestId ? '/contest/problem' : '/problem'
      const params = this.contestId ? {contest_id:this.contestId,problem_id:this.problemID} : {problem_id:this.problemID}
      axios.get(url,{params}).then(res => {
        if (!res.data.error) {
          this.problem = res.data.data
          if (this.problem.languages) {
            this.language = this.problem.languages.includes('Python3')?'Python3':this.problem.languages[0]
          }
        }
      }).finally(()=>{this.loading=false})
    },
    submitCode() {
      if (!this.code.trim()) { this.$Message.warning('代码不能为空'); return }
      this.submitting = true
      const d = {problem_id:this.problem.id,language:this.language,code:this.code}
      if (this.contestId) d.contest_id = this.contestId
      axios.post('/submission',d).then(res => {
        if (!res.data.error) {
          this.$Message.success('提交成功')
          if (res.data.data && res.data.data.submission_id) {
            this.$router.push({name:'submission-details',params:{id:res.data.data.submission_id}})
          }
        }
      }).finally(()=>{this.submitting=false})
    }
  },
  computed: {
    diffColor() {
      return {Low:'green',Mid:'blue',High:'red'}[this.problem.difficulty]||'default'
    }
  },
  watch: {
    $route() { this.problemID = this.$route.params.problemID; this.code = ''; this.loadProblem() }
  }
}
</script>

<style scoped>
.cp-wrap { max-width: 1200px; margin: 0 auto; padding: 0 4px; }
.cp-topbar { padding: 8px 0 10px; margin-bottom: 10px; border-bottom: 1px solid #e8eaec; display: flex; align-items: center; }
.cp-back { cursor: pointer; color: #2d8cf0; font-size: 14px; font-weight: 500; }
.cp-back:hover { color: #2b85e4; }
.cp-divider { margin: 0 12px; color: #dcdee2; }
.cp-course-name { color: #808695; font-size: 13px; }
.cp-loading,.cp-empty { text-align: center; padding: 60px 0; color: #999; }
.cp-main { display: flex; gap: 16px; align-items: flex-start; }
.cp-left { flex: 1; min-width: 0; }
.cp-right { width: 240px; flex-shrink: 0; }
.cp-content { font-size: 14px; line-height: 1.8; }
.cp-content h4 { margin: 14px 0 4px; font-size: 14px; font-weight: 600; color: #17233d; }
.cp-content > div > div { color: #515a6e; }
.cp-sample { display: flex; gap: 12px; margin: 6px 0 10px; }
.cp-sample > div { flex: 1; min-width: 0; }
.cp-sample span { font-size: 12px; color: #808695; }
.cp-sample pre { background: #f8f8f9; border: 1px solid #e8eaec; border-radius: 4px; padding: 8px 12px; margin: 2px 0 0; font-size: 13px; overflow-x: auto; }
.cp-info-item { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #f8f8f9; font-size: 13px; }
.cp-info-item span:first-child { color: #808695; }
.cp-stats { display: flex; justify-content: space-around; padding: 8px 0; }
.cp-stats > div { text-align: center; }
.cp-stats b { display: block; font-size: 18px; color: #17233d; }
.cp-stats span { font-size: 12px; color: #808695; }
.cp-submit-wrap { margin-top: 16px; }
.cp-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.cp-editor { width: 100%; min-height: 350px; padding: 14px; font-family: Monaco,Menlo,Consolas,monospace; font-size: 13px; line-height: 1.6; border: 1px solid #dcdee2; border-radius: 4px; resize: vertical; outline: none; background: #1e1e1e; color: #d4d4d4; tab-size: 4; }
.cp-editor::placeholder { color: #6a737d; }

@media (max-width: 768px) {
  .cp-main { flex-direction: column; }
  .cp-right { width: 100%; }
}
</style>
