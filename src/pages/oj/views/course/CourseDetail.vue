<template>
  <div class="course-detail">
    <!-- 教材头部 -->
    <Panel shadow>
      <div slot="title" class="course-header">
        <span class="course-title">{{ course.title }}</span>
        <span class="course-meta">
          {{ chapters.length }} 章节 ·
          {{ totalProblems }} 题
        </span>
      </div>
      <p v-if="course.description" class="course-desc">{{ course.description }}</p>
    </Panel>

    <!-- 章节列表 -->
    <div v-if="chapters.length">
      <Panel v-for="chapter in chapters" :key="chapter.id" style="margin-bottom: 12px">
        <div slot="title"
             class="chapter-header"
             @click="toggleChapter(chapter.id)">
          <Icon :type="expanded[chapter.id] ? 'ios-arrow-down' : 'ios-arrow-forward'" size="16"/>
          <span class="chapter-title-text">{{ chapter.title }}</span>
          <span class="chapter-problem-count">
            {{ chapter.examples.length + chapter.exercises.length }} 题
          </span>
          <!-- AC进度 -->
          <span v-if="chapterACCount(chapter) > 0" class="chapter-ac-progress">
            ({{ chapterACCount(chapter) }}/{{ chapter.examples.length + chapter.exercises.length }} AC)
          </span>
        </div>

        <div v-show="expanded[chapter.id]">
          <!-- 例题 -->
          <div v-if="chapter.examples.length" class="problem-section">
            <h4 class="section-label example-label">例题</h4>
            <Table :columns="tableColumns" :data="chapter.examples"
                   @on-row-click="goProblem" :no-data-text="'无'"
                   size="small" stripe/>
          </div>

          <!-- 习题 -->
          <div v-if="chapter.exercises.length" class="problem-section">
            <h4 class="section-label exercise-label">习题</h4>
            <Table :columns="tableColumns" :data="chapter.exercises"
                   @on-row-click="goProblem" :no-data-text="'无'"
                   size="small" stripe/>
          </div>

          <!-- 空章节提示 -->
          <div v-if="!chapter.examples.length && !chapter.exercises.length"
               style="text-align:center;color:#999;padding:20px">
            暂无题目
          </div>
        </div>
      </Panel>
    </div>

    <!-- 无章节 -->
    <div v-else style="text-align:center;color:#999;padding:40px">
      <p>暂无章节内容</p>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex'
import { ProblemMixin } from '@oj/components/mixins'
import utils from '@/utils/utils'
import axios from 'axios'

export default {
  name: 'CourseDetail',
  mixins: [ProblemMixin],
  data () {
    return {
      course: {},
      chapters: [],
      expanded: {},
      tableColumns: [
        {
          title: '#',
          key: '_id',
          width: 130,
          sortable: true,
          sortMethod: (a, b) => utils.compareDisplayId(a._id, b._id)
        },
        { title: '题目', key: 'title', minWidth: 150 },
        {
          title: '难度',
          width: 80,
          align: 'center',
          render: (h, params) => {
            const colors = { 'Low': 'green', 'Mid': 'blue', 'High': 'red' }
            return h('Tag', {
              props: { color: colors[params.row.difficulty] || 'default' }
            }, params.row.difficulty || '?')
          }
        },
        {
          title: '通过率',
          width: 100,
          align: 'center',
          render: (h, params) => h('span', this.getACRate(params.row.accepted_number, params.row.submission_number))
        }
      ]
    }
  },
  mounted () {
    this.courseId = parseInt(this.$route.params.courseId) || 0
    this.restoreExpanded()
    this.fetchCourse()
  },
  methods: {
    fetchCourse () {
      axios.get('/course/detail/?id=' + this.courseId).then(res => {
        if (!res.data.error) {
          this.course = res.data.data
          this.chapters = res.data.data.chapters || []
          this.applyACStatus()
        }
      })
    },
    applyACStatus () {
      const allProblems = []
      this.chapters.forEach(ch => {
        allProblems.push(...ch.examples, ...ch.exercises)
      })
      if (allProblems.length && this.isAuthenticated) {
        this.addStatusColumn(this.tableColumns, allProblems)
      }
    },
    chapterACCount (chapter) {
      const all = [...chapter.examples, ...chapter.exercises]
      return all.filter(p => p.my_status === 0).length
    },
    toggleChapter (chapterId) {
      this.$set(this.expanded, chapterId, !this.expanded[chapterId])
      this.saveExpanded()
    },
    lsKey () {
      return 'course_exp_' + this.courseId
    },
    saveExpanded () {
      try { localStorage.setItem(this.lsKey(), JSON.stringify(this.expanded)) } catch (e) {}
    },
    restoreExpanded () {
      try {
        const d = JSON.parse(localStorage.getItem(this.lsKey()))
        if (d) { this.expanded = d }
      } catch (e) {}
    },
    goProblem (row) {
      // 复用系统原有比赛题目页面，保持用户习惯一致性
      if (this.course.contest_id) {
        this.$router.push({
          name: 'contest-problem-details',
          params: {
            contestID: String(this.course.contest_id),
            problemID: row._id
          }
        })
      }
    }
  },
  computed: {
    ...mapGetters(['isAuthenticated']),
    totalProblems () {
      return this.chapters.reduce((s, ch) => s + ch.examples.length + ch.exercises.length, 0)
    }
  },
  watch: {
    isAuthenticated (v, o) {
      if (v && !o) { this.applyACStatus() }
    }
  }
}
</script>

<style scoped lang="less">
.course-detail {
  padding: 0;
  max-width: 100%;
}
.course-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0;
  .course-title { font-size: 18px; font-weight: 700; word-break: break-word; }
  .course-meta { color: #999; font-size: 13px; white-space: nowrap; }
}
.course-desc {
  color: #666;
  margin-top: 8px;
  padding-left: 4px;
  word-break: break-word;
  line-height: 1.6;
}
.chapter-header {
  display: flex;
  align-items: center;
  width: 100%;
  cursor: pointer;
  user-select: none;
  &:hover { color: #2d8cf0; }
  .chapter-title-text { margin-left: 8px; font-weight: bold; font-size: 15px; flex: 1; }
  .chapter-problem-count { margin-left: 12px; color: #999; font-size: 12px; white-space: nowrap; }
  .chapter-ac-progress { margin-left: 8px; color: #19be6b; font-size: 12px; white-space: nowrap; }
}
.problem-section { margin: 8px 16px 16px; }
.section-label {
  margin: 8px 0;
  font-size: 14px;
  &.example-label { color: #2d8cf0; }
  &.exercise-label { color: #19be6b; }
}
</style>
