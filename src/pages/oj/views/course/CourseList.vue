<template>
  <div class="course-list">
    <Panel shadow class="course-panel">
      <div slot="title" class="course-panel-title">配套题库</div>
      <div class="course-hero">
        <div>
          <p class="course-hero-kicker">系统化刷题路径</p>
          <p class="course-hero-desc">按照教材体系刷题，例题与习题结合，AC 后自动标记完成。</p>
        </div>
        <div class="course-hero-badge">
          <Icon type="ios-bookmarks-outline" size="20"/>
          <span>{{ courses.length }} 套题库</span>
        </div>
      </div>
      <Row :gutter="16" v-if="courses.length">
        <Col :xs="24" :sm="12" :md="8" :lg="6" v-for="course in courses" :key="course.id" style="margin-bottom:16px">
          <Card :bordered="true" class="course-card" @click.native="goCourse(course)">
            <div slot="title" class="course-card-head">
              <p class="course-card-title">{{ course.title }}</p>
              <span class="course-card-arrow">进入</span>
            </div>
            <p class="course-card-desc">{{ course.description || '暂无教材简介' }}</p>
            <div class="course-card-meta">
              <Tag color="blue">{{ course.chapter_count }} 章节</Tag>
              <Tag color="green">{{ course.problem_count }} 题</Tag>
            </div>
            <div class="course-card-footer">
              <span class="course-card-tip">点击查看章节与题目进度</span>
              <Icon type="ios-arrow-forward" size="18"/>
            </div>
          </Card>
        </Col>
      </Row>
      <div v-else class="course-empty">
        <Icon type="ios-book-outline" size="48"/>
        <p style="margin-top:16px">暂无教材</p>
      </div>
    </Panel>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'CourseList',
  data () {
    return {
      courses: []
    }
  },
  mounted () {
    this.fetchCourses()
  },
  methods: {
    fetchCourses () {
      axios.get('/courses/').then(res => {
        if (!res.data.error) {
          this.courses = res.data.data || []
        }
      }).catch(() => {})
    },
    goCourse (course) {
      this.$router.push({ name: 'course-detail', params: { courseId: String(course.id) } })
    }
  }
}
</script>

<style scoped lang="less">
.course-list {
  .course-panel {
    border-radius: 18px;
    overflow: hidden;
    background: linear-gradient(180deg, #f7fbff 0%, #ffffff 18%, #ffffff 100%);
  }

  .course-panel-title {
    font-size: 18px;
    font-weight: 700;
    color: #1f2d3d;
    letter-spacing: 1px;
  }

  .course-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    padding: 18px 22px;
    border-radius: 16px;
    background: linear-gradient(135deg, #eef6ff 0%, #f7fbff 50%, #ffffff 100%);
    border: 1px solid #e3eefc;
  }

  .course-hero-kicker {
    margin: 0 0 6px;
    font-size: 12px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #409eff;
    font-weight: 700;
  }

  .course-hero-desc {
    margin: 0;
    color: #6b778c;
    font-size: 14px;
    line-height: 1.8;
  }

  .course-hero-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 999px;
    background: #ffffff;
    border: 1px solid #d9e8fb;
    color: #2d8cf0;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
}

.course-card {
  cursor: pointer;
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s;
  border: 1px solid #e8eef5;
  box-shadow: 0 8px 22px rgba(31, 45, 61, 0.06);
  &:hover {
    box-shadow: 0 14px 28px rgba(45, 140, 240, 0.14);
    transform: translateY(-4px);
    border-color: #cfe3fb;
  }
  &-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  &-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #1f2d3d;
    flex: 1;
  }
  &-arrow {
    font-size: 12px;
    color: #409eff;
    font-weight: 600;
    white-space: nowrap;
  }
  &-desc {
    margin: 0;
    color: #5c6b7a;
    font-size: 13px;
    line-height: 1.9;
    min-height: 52px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: justify;
    text-justify: inter-ideograph;
  }
  &-meta {
    margin-top: 14px;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  &-footer {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px dashed #e6edf5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #8a97a6;
  }
  &-tip {
    font-size: 12px;
  }
}

.course-empty {
  text-align: center;
  color: #999;
  padding: 48px 16px;
}

@media (max-width: 768px) {
  .course-list {
    .course-hero {
      padding: 16px;
      align-items: flex-start;
      flex-direction: column;
    }

    .course-hero-badge {
      white-space: normal;
    }
  }

  .course-card {
    &-desc {
      min-height: auto;
    }
  }
}
</style>
