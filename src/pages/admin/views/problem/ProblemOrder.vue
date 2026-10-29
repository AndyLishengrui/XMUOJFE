<template>
  <div class="view problem-order">
    <Panel title="公共题库排序">
      <div slot="header" class="order-toolbar">
        <el-input
          v-model="keyword"
          prefix-icon="el-icon-search"
          placeholder="搜索题号 / 标题 / ID"
          clearable
          class="order-search">
        </el-input>
        <el-button icon="el-icon-refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="warning" :disabled="!dirty || saving" @click="resetOrder">清空编排</el-button>
        <el-button type="primary" :disabled="!dirty || saving" :loading="saving" @click="save">保存顺序</el-button>
        <span v-if="dirty" class="order-dirty">有未保存的修改</span>
      </div>

      <div class="order-tip">
        这里只调整学生端 <b>/problem</b> 列表的展示顺序，<b>不改变题号</b>（题目网址不变），
        也不影响实验 / 比赛内的题目顺序。未编排的题（新导入或后来发布的）会排在最末尾、按创建时间显示。
      </div>

      <el-table
        v-loading="loading"
        element-loading-text="loading"
        :data="pagedProblems"
        row-key="id"
        stripe
        height="620"
        style="width: 100%">
        <el-table-column label="顺序" width="80" align="center">
          <template slot-scope="{row}">{{ orderOf(row) }}</template>
        </el-table-column>
        <el-table-column prop="id" label="ID" width="90"></el-table-column>
        <el-table-column prop="_id" label="题号" width="130"></el-table-column>
        <el-table-column prop="title" label="标题" min-width="320"></el-table-column>
        <el-table-column label="编排状态" width="120" align="center">
          <template slot-scope="{row}">
            <el-tag v-if="row.sort_order" size="mini" type="success">已编排 {{ row.sort_order }}</el-tag>
            <el-tag v-else size="mini" type="info">未编排</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330" align="center">
          <template slot-scope="{row}">
            <el-button size="mini" :disabled="rowIndex(row) === 0" @click="move(row, -1)">上移</el-button>
            <el-button size="mini" :disabled="rowIndex(row) === allProblems.length - 1"
                       @click="move(row, 1)">下移</el-button>
            <el-button size="mini" type="text" :disabled="rowIndex(row) === 0" @click="moveTop(row)">置顶</el-button>
            <el-button size="mini" type="text" :disabled="rowIndex(row) === allProblems.length - 1"
                       @click="moveBottom(row)">置底</el-button>
            <el-button size="mini" type="text" @click="moveTo(row)">移动到…</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="order-footer">
        <span class="order-total">
          共 {{ allProblems.length }} 道可见公共题
          <template v-if="keyword">（当前筛选出 {{ filteredProblems.length }} 道）</template>
        </span>
        <el-pagination
          layout="prev, pager, next, sizes, jumper"
          :current-page.sync="currentPage"
          :page-size="pageSize"
          :page-sizes="[30, 50, 100, 200]"
          :total="filteredProblems.length"
          @size-change="handleSizeChange">
        </el-pagination>
      </div>
    </Panel>
  </div>
</template>

<script>
  import api from '../../api.js'

  export default {
    name: 'ProblemOrder',
    data () {
      return {
        loading: false,
        saving: false,
        keyword: '',
        allProblems: [],
        originalIds: [],
        currentPage: 1,
        pageSize: 50
      }
    },
    computed: {
      filteredProblems () {
        const keyword = this.keyword.trim().toLowerCase()
        if (!keyword) {
          return this.allProblems
        }
        return this.allProblems.filter(problem =>
          String(problem.id) === keyword ||
          String(problem._id).toLowerCase().includes(keyword) ||
          String(problem.title).toLowerCase().includes(keyword)
        )
      },
      pagedProblems () {
        const start = (this.currentPage - 1) * this.pageSize
        return this.filteredProblems.slice(start, start + this.pageSize)
      },
      dirty () {
        if (this.allProblems.length !== this.originalIds.length) {
          return true
        }
        return this.allProblems.some((problem, index) => problem.id !== this.originalIds[index])
      }
    },
    watch: {
      keyword () {
        this.currentPage = 1
      },
      filteredProblems (list) {
        const lastPage = Math.max(1, Math.ceil(list.length / this.pageSize))
        if (this.currentPage > lastPage) {
          this.currentPage = lastPage
        }
      }
    },
    mounted () {
      this.load()
    },
    methods: {
      load () {
        this.loading = true
        api.getPublicProblemOrder().then(res => {
          this.loading = false
          this.allProblems = res.data.data.results
          this.originalIds = this.allProblems.map(problem => problem.id)
        }, () => {
          this.loading = false
        })
      },
      orderOf (row) {
        return this.allProblems.indexOf(row) + 1
      },
      rowIndex (row) {
        return this.allProblems.indexOf(row)
      },
      focusRow (row) {
        const index = this.filteredProblems.indexOf(row)
        if (index >= 0) {
          this.currentPage = Math.floor(index / this.pageSize) + 1
        }
      },
      move (row, delta) {
        const index = this.allProblems.indexOf(row)
        const target = index + delta
        if (index < 0 || target < 0 || target >= this.allProblems.length) {
          return
        }
        const list = this.allProblems.slice()
        list.splice(index, 1)
        list.splice(target, 0, row)
        this.allProblems = list
        this.focusRow(row)
      },
      moveTop (row) {
        const index = this.allProblems.indexOf(row)
        if (index <= 0) {
          return
        }
        const list = this.allProblems.slice()
        list.splice(index, 1)
        list.unshift(row)
        this.allProblems = list
        this.focusRow(row)
      },
      moveBottom (row) {
        const index = this.allProblems.indexOf(row)
        if (index < 0 || index === this.allProblems.length - 1) {
          return
        }
        const list = this.allProblems.slice()
        list.splice(index, 1)
        list.push(row)
        this.allProblems = list
        this.focusRow(row)
      },
      moveTo (row) {
        const total = this.allProblems.length
        this.$prompt(`请输入目标位置（1 - ${total}）`, '移动到指定位置', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          inputPattern: /^[1-9]\d*$/,
          inputErrorMessage: `请输入 1 - ${total} 之间的整数`
        }).then(({value}) => {
          const target = parseInt(value, 10)
          if (!target || target > total) {
            this.$message.error(`目标位置必须在 1 - ${total} 之间`)
            return
          }
          const index = this.allProblems.indexOf(row)
          const list = this.allProblems.slice()
          list.splice(index, 1)
          list.splice(target - 1, 0, row)
          this.allProblems = list
          this.focusRow(row)
        }).catch(() => {})
      },
      handleSizeChange (size) {
        this.pageSize = size
        this.currentPage = 1
      },
      save () {
        this.saving = true
        const order = this.allProblems.map(problem => problem.id)
        api.savePublicProblemOrder(order).then(() => {
          this.saving = false
          this.originalIds = order.slice()
          this.load()
        }, () => {
          this.saving = false
        })
      },
      resetOrder () {
        this.$confirm('确定清空所有人工编排？清空后恢复按创建时间排序。', '清空编排', {
          confirmButtonText: '确定清空',
          cancelButtonText: '取消',
          type: 'warning'
        }).then(() => {
          return api.resetPublicProblemOrder()
        }).then(() => {
          this.load()
        }).catch(() => {})
      }
    }
  }
</script>

<style scoped lang="less">
  .problem-order {
    .order-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;

      .order-search {
        width: 320px;
      }

      .order-dirty {
        color: #e6a23c;
        font-size: 13px;
      }
    }

    .order-tip {
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #f4f8ff;
      border-left: 3px solid #409eff;
      color: #606266;
      font-size: 13px;
      line-height: 1.7;
    }

    .order-footer {
      margin-top: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .order-total {
        color: #909399;
        font-size: 13px;
      }
    }
  }
</style>
