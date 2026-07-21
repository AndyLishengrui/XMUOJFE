<template>
  <div class="course-admin">
    <el-breadcrumb separator="›" class="breadcrumb">
      <el-breadcrumb-item>教材管理</el-breadcrumb-item>
    </el-breadcrumb>

    <el-card class="main-card" shadow="never">
      <div slot="header">
        <div class="card-header">
          <div class="header-left">
            <i class="el-icon-s-management header-icon"></i>
            <span class="panel-title">教材管理</span>
            <el-tag type="success" size="mini" effect="dark" class="total-tag">
              共 {{ courses.length }} 套题库
            </el-tag>
          </div>
          <el-button type="primary" size="small" icon="el-icon-plus" @click="showCreate">
            新建题库
          </el-button>
        </div>
      </div>

      <el-table :data="courses" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="60" align="center"/>
        <el-table-column prop="title" label="题库标题" min-width="200">
          <template slot-scope="scope">
            <span :class="{ 'title-hidden': scope.row.visible === false }">
              <i class="el-icon-notebook-1" style="margin-right:6px;color:#409eff"></i>
              {{ scope.row.title }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip/>
        <el-table-column label="章节数" width="80" align="center">
          <template slot-scope="scope">
            <el-tag type="primary" size="small" effect="plain">
              {{ (scope.row.chapters || []).length }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="题目数" width="80" align="center">
          <template slot-scope="scope">
            <el-tag type="success" size="small" effect="plain">
              {{ scope.row.chapters ? scope.row.chapters.reduce((s, ch) => s + (ch.problems||[]).length, 0) : 0 }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可见" width="70" align="center">
          <template slot-scope="scope">
            <el-tag :type="scope.row.visible ? 'success' : 'info'" size="small" effect="dark">
              {{ scope.row.visible ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="order" label="排序" width="70" align="center"/>
        <el-table-column label="操作" width="320" align="center" fixed="right">
          <template slot-scope="scope">
            <div class="course-action-group">
              <el-button type="warning" size="mini" icon="el-icon-edit" plain @click="showEdit(scope.row)">编辑</el-button>
              <el-button type="success" size="mini" icon="el-icon-menu" @click="goChapters(scope.row)">章节</el-button>
              <el-button type="danger" size="mini" icon="el-icon-delete" plain @click="showDelete(scope.row)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 创建/编辑弹窗 -->
    <el-dialog :title="editing ? '编辑题库' : '新建题库'" :visible.sync="dialogVisible" width="500px"
               @closed="resetForm" class="dialog-custom">
      <el-form :model="form" :rules="rules" ref="formRef" label-width="80px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" placeholder="题库标题" maxlength="200"/>
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="题库描述"/>
        </el-form-item>
        <el-form-item label="排序" prop="order">
          <el-input-number v-model="form.order" :min="0" :max="9999"/>
        </el-form-item>
        <el-form-item label="可见" prop="visible">
          <el-switch v-model="form.visible"/>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="dialogVisible = false" class="btn-cancel">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">保存</el-button>
      </span>
    </el-dialog>

    <!-- 删除确认弹窗 -->
    <el-dialog :visible.sync="deleteDialogVisible" width="520px" class="dialog-custom dialog-delete"
               :close-on-click-modal="false" @closed="resetDelete">
      <div slot="title" class="delete-title">
        <i class="el-icon-warning-outline"></i>
        删除教材
      </div>

      <!-- 加载中 -->
      <div v-if="deleteLoading" class="delete-loading">
        <i class="el-icon-loading"></i> 正在获取教材信息...
      </div>

      <!-- 预览信息 -->
      <div v-else-if="deletePreview" class="delete-body">
        <div class="delete-warn">
          <i class="el-icon-warning"></i>
          <span>此操作将<strong>永久删除</strong>以下内容，且<strong>不可撤销</strong>：</span>
        </div>

        <div class="cascade-box">
          <div class="cascade-item cascade-course">
            <i class="el-icon-notebook-1"></i>
            <span>教材：<strong>{{ deletePreview.course.title }}</strong></span>
          </div>
          <div class="cascade-item cascade-chapter">
            <i class="el-icon-collection"></i>
            <span>章节：<strong>{{ deletePreview.cascade.chapters }} 个</strong></span>
            <ul class="chapter-list" v-if="deletePreview.cascade.chapter_list.length <= 10">
              <li v-for="ch in deletePreview.cascade.chapter_list" :key="ch.id">{{ ch.title }}</li>
            </ul>
            <ul class="chapter-list" v-else>
              <li v-for="ch in deletePreview.cascade.chapter_list.slice(0, 8)" :key="ch.id">{{ ch.title }}</li>
              <li class="chapter-more">...还有 {{ deletePreview.cascade.chapter_list.length - 8 }} 个章节</li>
            </ul>
          </div>
          <div class="cascade-item cascade-problem">
            <i class="el-icon-document"></i>
            <span>题目关联：<strong>{{ deletePreview.cascade.problems }} 道</strong></span>
          </div>
        </div>

        <div class="confirm-input-box">
          <p>请输入题库标题 <code>{{ deletePreview.course.title }}</code> 以确认删除：</p>
          <el-input
            v-model="deleteConfirmText"
            placeholder="请输入题库标题"
            :class="{ 'input-match': deleteConfirmText === deletePreview.course.title }"
            @keyup.enter.native="tryDelete"
          />
        </div>
      </div>

      <span slot="footer">
        <el-button @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger"
                   :disabled="deleteConfirmText !== (deletePreview && deletePreview.course.title)"
                   :loading="deleteSubmitting"
                   @click="tryDelete">
          {{ deleteConfirmText === (deletePreview && deletePreview.course.title) ? '确认删除' : '请输入题库标题确认' }}
        </el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import api from '../../api'

export default {
  name: 'CourseList',
  data () {
    return {
      courses: [],
      loading: false,
      dialogVisible: false,
      editing: false,
      submitting: false,
      editingId: null,
      form: { title: '', description: '', order: 0, visible: true },
      rules: {
        title: [{ required: true, message: '请输入题库标题', trigger: 'blur' }]
      },
      // 删除相关状态
      deleteDialogVisible: false,
      deleteLoading: false,
      deleteSubmitting: false,
      deletePreview: null,
      deleteTargetId: null,
      deleteConfirmText: ''
    }
  },
  mounted () {
    this.fetchCourses()
  },
  methods: {
    fetchCourses () {
      this.loading = true
      api.getCourses().then(res => {
        this.courses = res.data.data || []
        this.loading = false
      }).catch(() => { this.loading = false })
    },
    showCreate () {
      this.editing = false
      this.editingId = null
      this.form = { title: '', description: '', order: 0, visible: true }
      this.dialogVisible = true
    },
    showEdit (row) {
      this.editing = true
      this.editingId = row.id
      this.form = {
        title: row.title,
        description: row.description || '',
        order: row.order || 0,
        visible: row.visible !== false
      }
      this.dialogVisible = true
    },
    resetForm () {
      this.$nextTick(() => {
        if (this.$refs.formRef) this.$refs.formRef.resetFields()
      })
    },
    submitForm () {
      this.$refs.formRef.validate(valid => {
        if (!valid) return
        this.submitting = true
        if (this.editing) {
          api.updateCourse({ id: this.editingId, ...this.form }).then(() => {
            this.dialogVisible = false
            this.fetchCourses()
          }).finally(() => { this.submitting = false })
        } else {
          api.createCourse(this.form).then(() => {
            this.dialogVisible = false
            this.fetchCourses()
          }).finally(() => { this.submitting = false })
        }
      })
    },
    // 删除相关方法
    showDelete (row) {
      this.deleteDialogVisible = true
      this.deleteLoading = true
      this.deletePreview = null
      this.deleteConfirmText = ''
      this.deleteTargetId = row.id
      api.deleteCoursePreview(row.id).then(res => {
        this.deletePreview = res.data.data
      }).catch(() => {
        this.$message.error('获取教材信息失败')
        this.deleteDialogVisible = false
      }).finally(() => {
        this.deleteLoading = false
      })
    },
    resetDelete () {
      this.deletePreview = null
      this.deleteTargetId = null
      this.deleteConfirmText = ''
      this.deleteLoading = false
      this.deleteSubmitting = false
    },
    tryDelete () {
      if (this.deleteConfirmText !== (this.deletePreview && this.deletePreview.course.title)) {
        return
      }
      this.deleteSubmitting = true
      api.deleteCourseConfirm(this.deleteTargetId).then(res => {
        const data = res.data.data
        this.$message.success(data.message || '删除成功')
        this.deleteDialogVisible = false
        this.fetchCourses()
      }).catch(() => {
        this.$message.error('删除失败')
      }).finally(() => {
        this.deleteSubmitting = false
      })
    },
    goChapters (row) {
      this.$router.push({ name: 'course-chapters', params: { courseId: String(row.id) }, query: { title: row.title } })
    }
  }
}
</script>

<style scoped lang="less">
.course-admin {
  padding: 0;
  max-width: 1400px;
  margin: 0 auto;
}

.breadcrumb {
  margin-bottom: 20px;
  font-size: 14px;
}

.main-card {
  border-radius: 8px;
  overflow: hidden;
}

.main-card .el-table {
  border-radius: 6px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  font-size: 22px;
  color: #409eff;
}

.panel-title {
  font-size: 17px;
  font-weight: 600;
  color: #303133;
}

.total-tag {
  font-size: 12px;
}

.title-hidden {
  opacity: 0.5;
}

.course-action-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.course-action-group .el-button {
  margin-left: 0;
}

.dialog-custom .el-dialog__header {
  border-bottom: 1px solid #ebeef5;
  padding: 18px 24px;
}

.dialog-custom .el-dialog__body {
  padding: 24px;
}

.dialog-custom .el-dialog__footer {
  border-top: 1px solid #ebeef5;
  padding: 14px 24px;
}

.btn-cancel {
  color: #606266;
}

// 删除弹窗样式
.dialog-delete {
  .delete-title {
    color: #e6a23c;
    font-size: 18px;
    i { margin-right: 8px; font-size: 22px; vertical-align: -2px; }
  }

  .delete-loading {
    text-align: center;
    padding: 40px 0;
    color: #909399;
    font-size: 15px;
    i { font-size: 24px; margin-right: 8px; }
  }

  .delete-body {
    .delete-warn {
      background: #fef0f0;
      border: 1px solid #fde2e2;
      border-radius: 6px;
      padding: 14px 16px;
      color: #f56c6c;
      margin-bottom: 20px;
      font-size: 14px;
      line-height: 1.6;
      i { margin-right: 8px; font-size: 18px; vertical-align: -1px; }
    }

    .cascade-box {
      background: #f5f7fa;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 20px;
    }

    .cascade-item {
      padding: 8px 0;
      font-size: 14px;
      border-bottom: 1px dashed #e4e7ed;
      &:last-child { border-bottom: none; }
      i { margin-right: 8px; color: #909399; }
    }

    .cascade-course i { color: #409eff; }
    .cascade-chapter i { color: #e6a23c; }
    .cascade-problem i { color: #67c23a; }

    .chapter-list {
      margin: 4px 0 0 24px;
      padding: 0;
      list-style: none;
      font-size: 13px;
      color: #909399;
      li {
        padding: 2px 0;
        &::before { content: '· '; font-weight: bold; }
      }
      .chapter-more {
        color: #c0c4cc;
        font-style: italic;
      }
    }

    .confirm-input-box {
      p {
        font-size: 14px;
        color: #606266;
        margin-bottom: 10px;
        code {
          background: #ecf5ff;
          color: #409eff;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
        }
      }

      .el-input {
        /deep/ .el-input__inner {
          border-color: #dcdfe6;
          transition: border-color 0.3s;
        }
      }

      .input-match {
        /deep/ .el-input__inner {
          border-color: #67c23a !important;
          background: #f0f9eb;
        }
      }
    }
  }
}
</style>
