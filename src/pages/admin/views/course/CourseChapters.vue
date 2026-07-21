<template>
  <div class="chapter-admin">
    <el-breadcrumb separator="›" class="breadcrumb">
      <el-breadcrumb-item :to="{ name: 'course-list' }">教材管理</el-breadcrumb-item>
      <el-breadcrumb-item>{{ courseTitle }}</el-breadcrumb-item>
    </el-breadcrumb>

    <el-card class="main-card" shadow="never">
      <div slot="header">
        <div class="card-header">
          <div class="header-left">
            <i class="el-icon-notebook-2 header-icon"></i>
            <span class="panel-title">{{ courseTitle }}</span>
            <el-tag type="success" size="mini" effect="dark" class="section-tag">章节管理</el-tag>
          </div>
          <el-button type="primary" size="small" icon="el-icon-plus" @click="showCreateChapter">
            新建章节
          </el-button>
        </div>
      </div>

      <el-table ref="chapterTable" :data="chapters" v-loading="loading" stripe row-key="id"
            :expand-row-keys="expandedChapterIds"
                @expand-change="onExpand">
        <el-table-column type="expand">
          <template slot-scope="scope">
            <div class="expand-content">
              <div class="expand-header">
                <span class="expand-title">
                  <i class="el-icon-document"></i> 题目列表
                </span>
                <el-button type="primary" size="mini" icon="el-icon-plus" @click="showAddProblem(scope.row)">
                  添加题目
                </el-button>
              </div>
              <el-table :data="scope.row._problems || []" size="small"
                        v-loading="scope.row._loadingProblems" row-key="display_id">
                <el-table-column label="#" width="50" align="center">
                  <template slot-scope="ps">
                    <span class="row-index">{{ ps.$index + 1 }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="题号" min-width="180">
                  <template slot-scope="ps">
                    <div class="problem-info">
                      <span class="problem-id">{{ ps.row.display_id }}</span>
                      <span class="problem-title">{{ ps.row._title || '' }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="类型" width="90" align="center">
                  <template slot-scope="ps">
                    <el-select v-model="ps.row.type" size="mini" class="type-select"
                               @change="onTypeChange(scope.row, ps.row)">
                      <el-option label="📖 例题" value="example"/>
                      <el-option label="📝 习题" value="exercise"/>
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="180" align="center">
                  <template slot-scope="ps">
                    <div class="problem-action-group">
                      <el-tooltip content="上移" placement="top">
                        <el-button size="mini" plain class="problem-action-btn"
                          :disabled="ps.$index === 0"
                          @click="moveUp(scope.row, ps)">
                          上移
                        </el-button>
                      </el-tooltip>
                      <el-tooltip content="下移" placement="top">
                        <el-button size="mini" plain class="problem-action-btn"
                          :disabled="ps.$index === (scope.row._problems||[]).length - 1"
                          @click="moveDown(scope.row, ps)">
                          下移
                        </el-button>
                      </el-tooltip>
                      <el-dropdown trigger="click" class="problem-action-dropdown" @command="(cmd) => onProblemAction(cmd, scope.row, ps.row)">
                        <el-button size="mini" plain class="problem-action-btn problem-action-more">
                          更多
                          <i class="el-icon-arrow-down el-icon--right"></i>
                        </el-button>
                        <el-dropdown-menu slot="dropdown">
                          <el-dropdown-item command="move"><i class="el-icon-rank"></i> 移动到其他章节</el-dropdown-item>
                          <el-dropdown-item command="remove" class="danger-item"><i class="el-icon-delete"></i> 移除此题</el-dropdown-item>
                        </el-dropdown-menu>
                      </el-dropdown>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="!(scope.row._problems && scope.row._problems.length)"
                   class="empty-problems">
                <i class="el-icon-warning-outline"></i>
                暂无题目
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="80" align="center"/>
        <el-table-column prop="title" label="章节标题" min-width="250">
          <template slot-scope="scope">
            <span :class="{ 'title-hidden': scope.row.visible === false }">
              <i class="el-icon-document-copy" style="margin-right:6px;color:#409eff"></i>
              {{ scope.row.title }}
            </span>
            <el-tag v-if="scope.row.visible === false" type="warning" size="mini" effect="plain" class="hidden-tag">已隐藏</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="题目数" width="100" align="center">
          <template slot-scope="scope">
            <el-tag :type="(scope.row.problems || []).length > 0 ? 'primary' : 'info'" size="small" effect="plain" class="count-tag">
              {{ (scope.row.problems || []).length }} 题
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可见" width="80" align="center">
          <template slot-scope="scope">
            <el-switch
              v-model="scope.row.visible"
              @change="toggleChapterVisible(scope.row)"
              active-color="#13ce66"
              inactive-color="#ff4949"/>
          </template>
        </el-table-column>
        <el-table-column prop="order" label="排序" width="80" align="center"/>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template slot-scope="scope">
            <el-button type="warning" size="mini" icon="el-icon-edit" plain @click="showEditChapter(scope.row)">编辑</el-button>
            <el-popconfirm title="删除章节将同时移除所有题目关联，确定删除？" @onConfirm="doDeleteChapter(scope.row.id)">
              <el-button slot="reference" type="danger" size="mini" icon="el-icon-delete" plain>删除</el-button>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 章节弹窗 -->
    <el-dialog :title="chapterEditing ? '编辑章节' : '新建章节'" :visible.sync="chapterDialogVisible" width="500px"
               @closed="resetChapterForm" class="dialog-custom">
      <el-form :model="chapterForm" :rules="chapterRules" ref="chapterFormRef" label-width="80px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="chapterForm.title" placeholder="章节标题" maxlength="200"/>
        </el-form-item>
        <el-form-item label="排序" prop="order">
          <el-input-number v-model="chapterForm.order" :min="0" :max="9999"/>
        </el-form-item>
        <el-form-item label="可见">
          <el-switch v-model="chapterForm.visible" active-text="学生可见" inactive-text="隐藏"/>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="chapterDialogVisible = false" class="btn-cancel">取消</el-button>
        <el-button type="primary" @click="submitChapterForm" :loading="chapterSubmitting">保存</el-button>
      </span>
    </el-dialog>

    <!-- 添加题目弹窗 -->
    <el-dialog title="添加题目到章节" :visible.sync="problemDialogVisible" width="550px" @closed="resetProblemForm"
               class="dialog-custom">
      <el-form :model="problemForm" :rules="problemRules" ref="problemFormRef" label-width="80px">
        <el-form-item label="搜索题目" prop="display_id">
          <el-select v-model="problemForm.display_id" filterable remote
            :remote-method="searchProblems"
            :loading="problemSearching"
            placeholder="输入题号或标题搜索..."
            style="width:100%"
            @change="onProblemSelect">
            <el-option v-for="prob in problemOptions" :key="prob._id"
              :label="prob._id + ' - ' + prob.title"
              :value="prob._id">
              <span class="opt-id">{{ prob._id }}</span>
              <span class="opt-title">{{ prob.title }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="problemForm.type">
            <el-radio-button label="example">📖 例题</el-radio-button>
            <el-radio-button label="exercise">📝 习题</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="problemForm.order" :min="0" :max="9999"/>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="problemDialogVisible = false" class="btn-cancel">取消</el-button>
        <el-button type="primary" @click="submitProblemForm" :loading="problemSubmitting">添加</el-button>
      </span>
    </el-dialog>

    <!-- 移动题目弹窗 -->
    <el-dialog title="移动题目" :visible.sync="moveDialogVisible" width="450px" class="dialog-custom">
      <p class="move-info">
        将 <b>{{ moveTarget ? moveTarget.display_id : '' }}</b>
        从「{{ moveFromChapter ? moveFromChapter.title : '' }}」移动到：
      </p>
      <el-select v-model="moveToChapterId" placeholder="选择目标章节" style="width:100%">
        <el-option v-for="ch in chapters" :key="ch.id"
                   :label="ch.title + ' (' + (ch.problems||[]).length + '题)'"
                   :value="ch.id"
                   :disabled="moveFromChapter && ch.id === moveFromChapter.id"/>
      </el-select>
      <span slot="footer">
        <el-button @click="moveDialogVisible = false" class="btn-cancel">取消</el-button>
        <el-button type="primary" @click="doMoveProblem" :loading="moveSubmitting">移动</el-button>
      </span>
    </el-dialog>

    <!-- 编辑排序弹窗 -->
    <el-dialog title="修改排序" :visible.sync="orderDialogVisible" width="350px" class="dialog-custom">
      <el-form :model="orderForm" label-width="80px">
        <el-form-item label="题号">
          <span style="font-weight:bold">{{ orderTarget ? orderTarget.display_id : '' }}</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="orderForm.order" :min="0" :max="9999"/>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button @click="orderDialogVisible = false" class="btn-cancel">取消</el-button>
        <el-button type="primary" @click="doEditOrder" :loading="orderSubmitting">保存</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import api from '../../api'

export default {
  name: 'CourseChapters',
  data () {
    return {
      courseId: null,
      courseTitle: '',
      chapters: [],
      expandedChapterIds: [],
      loading: false,
      // Chapter form
      chapterDialogVisible: false,
      chapterEditing: false,
      chapterSubmitting: false,
      chapterEditingId: null,
      chapterForm: { title: '', order: 0, visible: true },
      chapterRules: {
        title: [{ required: true, message: '请输入章节标题', trigger: 'blur' }]
      },
      // Problem form
      problemDialogVisible: false,
      problemSubmitting: false,
      problemTargetChapter: null,
      problemForm: { display_id: '', type: 'exercise', order: 0 },
      problemRules: {
        display_id: [{ required: true, message: '请搜索并选择题号', trigger: 'change' }]
      },
      problemOptions: [],
      problemSearching: false,
      // Move problem
      moveDialogVisible: false,
      moveSubmitting: false,
      moveTarget: null,
      moveFromChapter: null,
      moveToChapterId: null,
      // Edit order
      orderDialogVisible: false,
      orderSubmitting: false,
      orderTarget: null,
      orderFromChapter: null,
      orderForm: { order: 0 }
    }
  },
  mounted () {
    this.courseId = parseInt(this.$route.params.courseId) || 0
    this.courseTitle = this.$route.query.title || '配套题库'
    this.fetchChapters()
  },
  methods: {
    fetchChapters () {
      const expandedIds = [...this.expandedChapterIds]
      this.loading = true
      api.getChapters(this.courseId).then(res => {
        this.chapters = (res.data.data || []).map(ch => ({
          ...ch,
          _problems: null,
          _loadingProblems: false
        }))
        this.expandedChapterIds = expandedIds.filter(id => this.chapters.some(ch => ch.id === id))
        this.$nextTick(() => {
          this.expandedChapterIds.forEach(id => {
            const chapter = this.chapters.find(ch => ch.id === id)
            if (chapter) this.loadChapterProblems(chapter)
          })
        })
        this.loading = false
      }).catch(() => { this.loading = false })
    },
    onExpand (row, expandedRows) {
      this.expandedChapterIds = expandedRows.map(item => item.id)
      if (expandedRows.includes(row) && !row._problems) {
        this.loadChapterProblems(row)
      }
    },
    loadChapterProblems (row) {
      this.$set(row, '_loadingProblems', true)
      api.getChapterProblems(this.courseId, row.id).then(res => {
        const probs = (res.data.data || []).map(p => ({...p, _editOrder: p.order}))
        // Batch fetch titles
        const ids = probs.map(p => p.display_id).filter(Boolean)
        if (ids.length) {
          api.getProblemTitles(ids).then(tr => {
            const titles = tr.data.data || {}
            probs.forEach(p => { p._title = titles[p.display_id] || '' })
            this.$set(row, '_problems', [...probs])
            this.$set(row, '_loadingProblems', false)
          }).catch(() => {
            this.$set(row, '_problems', probs)
            this.$set(row, '_loadingProblems', false)
          })
        } else {
          this.$set(row, '_problems', probs)
          this.$set(row, '_loadingProblems', false)
        }
      }).catch(() => { this.$set(row, '_loadingProblems', false) })
    },
    // Chapter CRUD
    showCreateChapter () {
      this.chapterEditing = false
      this.chapterEditingId = null
      this.chapterForm = { title: '', order: 0, visible: true }
      this.chapterDialogVisible = true
    },
    showEditChapter (row) {
      this.chapterEditing = true
      this.chapterEditingId = row.id
      this.chapterForm = {
        title: row.title,
        order: row.order || 0,
        visible: row.visible !== false
      }
      this.chapterDialogVisible = true
    },
    resetChapterForm () {
      this.$nextTick(() => {
        if (this.$refs.chapterFormRef) this.$refs.chapterFormRef.resetFields()
      })
    },
    submitChapterForm () {
      this.$refs.chapterFormRef.validate(valid => {
        if (!valid) return
        this.chapterSubmitting = true
        if (this.chapterEditing) {
          api.updateChapter({ course_id: this.courseId, id: this.chapterEditingId, ...this.chapterForm }).then(() => {
            this.chapterDialogVisible = false
            this.fetchChapters()
          }).finally(() => { this.chapterSubmitting = false })
        } else {
          api.createChapter({ course_id: this.courseId, ...this.chapterForm }).then(() => {
            this.chapterDialogVisible = false
            this.fetchChapters()
          }).finally(() => { this.chapterSubmitting = false })
        }
      })
    },
    doDeleteChapter (chapterId) {
      api.deleteChapter(this.courseId, chapterId).then(() => {
        this.fetchChapters()
      })
    },
    toggleChapterVisible (row) {
      api.updateChapter({
        course_id: this.courseId,
        id: row.id,
        visible: row.visible
      }).catch(() => {
        row.visible = !row.visible  // revert on error
      })
    },
    // Problem management
    searchProblems (query) {
      if (!query || query.length < 1) { this.problemOptions = []; return }
      this.problemSearching = true
      api.getProblemList({ keyword: query, limit: 20 }).then(res => {
        this.problemOptions = (res.data.data.results || []).filter(p => p.visible)
        this.problemSearching = false
      }).catch(() => { this.problemSearching = false })
    },
    onProblemSelect (val) {
      // Update order hint to next available
      if (this.problemTargetChapter && this.problemTargetChapter._problems) {
        this.problemForm.order = this.problemTargetChapter._problems.length + 1
      }
    },
    showAddProblem (chapterRow) {
      this.problemTargetChapter = chapterRow
      this.problemForm = { display_id: '', type: 'exercise', order: 0 }
      this.problemOptions = []
      this.problemDialogVisible = true
    },
    resetProblemForm () {
      this.$nextTick(() => {
        if (this.$refs.problemFormRef) this.$refs.problemFormRef.resetFields()
      })
    },
    submitProblemForm () {
      this.$refs.problemFormRef.validate(valid => {
        if (!valid) return
        this.problemSubmitting = true
        api.addProblemToChapter({
          course_id: this.courseId,
          chapter_id: this.problemTargetChapter.id,
          ...this.problemForm
        }).then(() => {
          this.problemDialogVisible = false
          this.loadChapterProblems(this.problemTargetChapter)
          this.fetchChapters()
        }).finally(() => { this.problemSubmitting = false })
      })
    },
    onTypeChange (chapterRow, problemRow) {
      api.updateChapterProblem({
        course_id: this.courseId,
        chapter_id: chapterRow.id,
        display_id: problemRow.display_id,
        type: problemRow.type
      }).catch(() => {
        // revert on error
        problemRow.type = problemRow.type === 'example' ? 'exercise' : 'example'
      })
    },
    doRemoveProblem (chapterRow, problemRow) {
      api.removeProblemFromChapter(this.courseId, chapterRow.id, problemRow.display_id).then(() => {
        this.loadChapterProblems(chapterRow)
        this.fetchChapters()
      })
    },
    // Move problem
    showMoveProblem (chapterRow, problemRow) {
      this.moveFromChapter = chapterRow
      this.moveTarget = problemRow
      this.moveToChapterId = null
      this.moveDialogVisible = true
    },
    doMoveProblem () {
      if (!this.moveToChapterId) {
        this.$message.warning('请选择目标章节')
        return
      }
      this.moveSubmitting = true
      api.moveProblemToChapter({
        course_id: this.courseId,
        from_chapter_id: this.moveFromChapter.id,
        to_chapter_id: this.moveToChapterId,
        display_id: this.moveTarget.display_id,
        type: this.moveTarget.type
      }).then(() => {
        this.moveDialogVisible = false
        this.loadChapterProblems(this.moveFromChapter)
        // Also find and reload the target chapter
        const targetCh = this.chapters.find(c => c.id === this.moveToChapterId)
        if (targetCh) this.loadChapterProblems(targetCh)
        this.fetchChapters()
      }).finally(() => { this.moveSubmitting = false })
    },
    // Move problem up/down within chapter
    swapOrder (chapterRow, idx1, idx2) {
      const probs = chapterRow._problems
      if (!probs || idx1 < 0 || idx2 < 0 || idx1 >= probs.length || idx2 >= probs.length) return
      // Swap in UI
      const tmp = probs[idx1]
      this.$set(probs, idx1, probs[idx2])
      this.$set(probs, idx2, tmp)
      // Persist new orders
      const requests = probs.map((p, i) => {
        p.order = i + 1
        return api.updateChapterProblem({
          course_id: this.courseId,
          chapter_id: chapterRow.id,
          display_id: p.display_id,
          order: i + 1
        })
      })
      Promise.all(requests).then(() => {
        this.loadChapterProblems(chapterRow)
      }).catch(() => {
        this.loadChapterProblems(chapterRow)
      })
    },
    moveUp (chapterRow, ps) {
      this.swapOrder(chapterRow, ps.$index, ps.$index - 1)
    },
    moveDown (chapterRow, ps) {
      this.swapOrder(chapterRow, ps.$index, ps.$index + 1)
    },
    onProblemAction (cmd, chapterRow, problemRow) {
      if (cmd === 'move') {
        this.showMoveProblem(chapterRow, problemRow)
      } else if (cmd === 'remove') {
        this.$confirm('确定移除此题？', '提示', { type: 'warning' }).then(() => {
          this.doRemoveProblem(chapterRow, problemRow)
        }).catch(() => {})
      }
    },
    // Edit order
    showEditOrder (chapterRow, problemRow) {
      this.orderFromChapter = chapterRow
      this.orderTarget = problemRow
      this.orderForm = { order: problemRow.order || 0 }
      this.orderDialogVisible = true
    },
    doEditOrder () {
      this.orderSubmitting = true
      api.updateChapterProblem({
        course_id: this.courseId,
        chapter_id: this.orderFromChapter.id,
        display_id: this.orderTarget.display_id,
        order: this.orderForm.order
      }).then(() => {
        this.orderDialogVisible = false
        this.loadChapterProblems(this.orderFromChapter)
      }).finally(() => { this.orderSubmitting = false })
    }
  }
}
</script>

<style scoped lang="less">
.chapter-admin {
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

.section-tag {
  font-size: 12px;
}

.count-tag {
  font-weight: 500;
}

.title-hidden {
  opacity: 0.5;
}

.hidden-tag {
  margin-left: 6px;
  vertical-align: middle;
}

.expand-content {
  padding: 16px 24px;
  background: #fafafa;
}

.expand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.expand-title {
  font-size: 14px;
  font-weight: 600;
  color: #606266;
}

.expand-title i {
  margin-right: 6px;
  color: #409eff;
}

.row-index {
  color: #909399;
  font-size: 12px;
  font-weight: 500;
}

.problem-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.problem-id {
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #303133;
  background: #f0f5ff;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 13px;
}

.problem-title {
  color: #909399;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.type-select {
  width: 82px;
}

.problem-action-group {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  background: #fff;
}

.problem-action-btn {
  min-width: 48px;
  margin: 0;
  border: 0;
  border-radius: 0;
  padding: 7px 10px;
}

.problem-action-btn.is-plain:focus,
.problem-action-btn.is-plain:hover {
  background: #ecf5ff;
  color: #409eff;
}

.problem-action-dropdown {
  display: flex;
}

.problem-action-group .problem-action-btn + .problem-action-btn,
.problem-action-dropdown .problem-action-btn {
  border-left: 1px solid #dcdfe6;
}

.problem-action-more {
  min-width: 58px;
}

.empty-problems {
  text-align: center;
  color: #c0c4cc;
  padding: 20px;
  font-size: 13px;
}

.empty-problems i {
  margin-right: 6px;
  font-size: 16px;
  vertical-align: middle;
}

.move-info {
  margin-bottom: 14px;
  color: #606266;
  font-size: 14px;
  line-height: 1.6;
}

.move-info b {
  color: #409eff;
  font-weight: 600;
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

.opt-id {
  float: left;
  font-weight: 600;
  color: #303133;
}

.opt-title {
  float: right;
  color: #909399;
  font-size: 13px;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.danger-item {
  color: #f56c6c !important;
}
</style>