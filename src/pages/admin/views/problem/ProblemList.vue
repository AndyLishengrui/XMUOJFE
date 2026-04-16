<template>
  <div class="view">
    <Panel :title="contestId ? this.$i18n.t('m.Contest_Problem_List') : this.$i18n.t('m.Problem_List')">
      <div slot="header">
        <div class="list-toolbar">
          <el-input
            v-model="keyword"
            prefix-icon="el-icon-search"
            placeholder="Keywords">
          </el-input>
          <div v-if="isBatchManageEnabled" class="toolbar-toggles">
            <el-switch v-model="showTags" active-text="Show Tags"></el-switch>
            <el-switch v-model="showSource" active-text="Show Source"></el-switch>
          </div>
        </div>
      </div>
      <el-table
        v-loading="loading"
        element-loading-text="loading"
        ref="table"
        :data="problemList"
        @selection-change="handleSelectionChange"
        @row-dblclick="handleDblclick"
        style="width: 100%">
        <el-table-column
          v-if="isBatchManageEnabled"
          type="selection"
          width="55">
        </el-table-column>
        <el-table-column
          width="100"
          prop="id"
          label="ID">
        </el-table-column>
        <el-table-column
          width="150"
          label="Display ID">
          <template slot-scope="{row}">
            <span v-show="!row.isEditing">{{row._id}}</span>
            <el-input v-show="row.isEditing" v-model="row._id"
                      @keyup.enter.native="handleInlineEdit(row)">

            </el-input>
          </template>
        </el-table-column>
        <el-table-column
          prop="title"
          label="Title">
          <template slot-scope="{row}">
            <span v-show="!row.isEditing">{{row.title}}</span>
            <el-input v-show="row.isEditing" v-model="row.title"
                      @keyup.enter.native="handleInlineEdit(row)">
            </el-input>
          </template>
        </el-table-column>
        <el-table-column
          prop="created_by.username"
          label="Author">
        </el-table-column>
        <el-table-column
          width="200"
          prop="create_time"
          label="Create Time">
          <template slot-scope="scope">
            {{scope.row.create_time | localtime }}
          </template>
        </el-table-column>
        <el-table-column
          width="100"
          prop="visible"
          label="Visible">
          <template slot-scope="scope">
            <el-switch v-model="scope.row.visible"
                       active-text=""
                       inactive-text=""
                       @change="updateProblem(scope.row)">
            </el-switch>
          </template>
        </el-table-column>
        <el-table-column v-if="showTags" min-width="220" label="Tags">
          <template slot-scope="{row}">
            <div class="tag-list-cell">
              <el-tag v-for="tag in row.tags" :key="row.id + '-' + tag" size="mini" type="success">{{tag}}</el-tag>
              <span v-if="!row.tags || row.tags.length === 0">-</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="showSource" min-width="180" prop="source" label="Source">
          <template slot-scope="{row}">
            <span>{{row.source || '-'}}</span>
          </template>
        </el-table-column>
        <el-table-column
          fixed="right"
          label="Operation"
          width="250">
          <div slot-scope="scope">
            <icon-btn name="Edit" icon="edit" @click.native="goEdit(scope.row.id)"></icon-btn>
            <icon-btn v-if="contestId" name="Make Public" icon="clone"
                      @click.native="makeContestProblemPublic(scope.row.id)"></icon-btn>
            <icon-btn icon="download" name="Download TestCase"
                      @click.native="downloadTestCase(scope.row.id)"></icon-btn>
            <icon-btn icon="trash" name="Delete Problem"
                      @click.native="deleteProblem(scope.row.id)"></icon-btn>
          </div>
        </el-table-column>
      </el-table>
      <div class="panel-options">
        <el-button v-if="isBatchManageEnabled" type="warning" size="small" :disabled="selectedProblemIds.length === 0"
                   @click="batchTagsDialogVisible = true">Batch Edit Tags
        </el-button>
        <el-button v-if="isBatchManageEnabled" type="warning" size="small" :disabled="selectedProblemIds.length === 0"
                   @click="batchSourceDialogVisible = true">Batch Edit Source
        </el-button>
        <el-button type="primary" size="small"
                   @click="goCreateProblem" icon="el-icon-plus">Create
        </el-button>
        <el-button v-if="contestId" type="primary"
                   size="small" icon="el-icon-plus"
                   @click="addProblemDialogVisible = true">Add From Public Problem
        </el-button>
        <el-pagination
          class="page"
          layout="prev, pager, next, sizes"
          @current-change="currentChange"
          @size-change="handlePageSizeChange"
          :current-page="currentPage"
          :page-size="pageSize"
          :page-sizes="pageSizes"
          :total="total">
        </el-pagination>
      </div>
    </Panel>
    <el-dialog title="Sure to update the problem? "
               width="20%"
               :visible.sync="InlineEditDialogVisible"
               @close-on-click-modal="false">
      <div>
        <p>DisplayID: {{currentRow._id}}</p>
        <p>Title: {{currentRow.title}}</p>
      </div>
      <span slot="footer">
        <cancel @click.native="InlineEditDialogVisible = false; getProblemList(currentPage)"></cancel>
        <save @click.native="updateProblem(currentRow)"></save>
      </span>
    </el-dialog>
    <el-dialog title="Add Contest Problem"
               v-if="contestId"
               width="80%"
               :visible.sync="addProblemDialogVisible"
               @close-on-click-modal="false">
      <add-problem-component :contestID="contestId" @on-change="getProblemList"></add-problem-component>
    </el-dialog>
    <el-dialog title="Batch Edit Tags"
               width="560px"
               :visible.sync="batchTagsDialogVisible"
               @close="resetBatchTagsState">
      <el-form label-position="top">
        <el-form-item label="Operation">
          <el-radio-group v-model="batchTags.operation">
            <el-radio label="replace">Replace</el-radio>
            <el-radio label="append">Append</el-radio>
            <el-radio label="remove">Remove</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Tags">
          <el-select v-model="batchTags.tags" multiple filterable allow-create default-first-option style="width: 100%" placeholder="Select or input tags">
            <el-option v-for="tag in availableTags" :key="'available-tag-' + tag" :label="tag" :value="tag"></el-option>
          </el-select>
          <p class="batch-help">If the result leaves a problem without tags, the backend will add toTag automatically.</p>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <cancel @click.native="batchTagsDialogVisible = false"></cancel>
        <save @click.native="submitBatchTags"></save>
      </span>
    </el-dialog>
    <el-dialog title="Batch Edit Source"
               width="520px"
               :visible.sync="batchSourceDialogVisible"
               @close="resetBatchSourceState">
      <el-form label-position="top">
        <el-form-item label="Source">
          <el-input v-model="batchSource.source" placeholder="Empty value will clear source"></el-input>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <cancel @click.native="batchSourceDialogVisible = false"></cancel>
        <save @click.native="submitBatchSource"></save>
      </span>
    </el-dialog>
  </div>
</template>

<script>
  import api from '../../api.js'
  import utils from '@/utils/utils'
  import AddProblemComponent from './AddPublicProblem.vue'

  export default {
    name: 'ProblemList',
    components: {
      AddProblemComponent
    },
    data () {
      return {
        pageSize: 10,
        pageSizes: [10, 30, 50, 100, 200],
        total: 0,
        problemList: [],
        keyword: '',
        loading: false,
        currentPage: 1,
        routeName: '',
        contestId: '',
        // for make public use
        currentProblemID: '',
        currentRow: {},
        InlineEditDialogVisible: false,
        makePublicDialogVisible: false,
        addProblemDialogVisible: false,
        syncingRouteState: false,
        showTags: false,
        showSource: false,
        selectedProblemIds: [],
        availableTags: [],
        batchTagsDialogVisible: false,
        batchSourceDialogVisible: false,
        batchTags: {
          operation: 'replace',
          tags: []
        },
        batchSource: {
          source: ''
        }
      }
    },
    computed: {
      isSuperAdmin () {
        return this.$store.getters.isSuperAdmin
      },
      isBatchManageEnabled () {
        return !this.contestId && this.isSuperAdmin
      }
    },
    mounted () {
      this.routeName = this.$route.name
      this.contestId = this.$route.params.contestId
      this.applyRouteState(this.$route)
      if (this.isBatchManageEnabled) {
        this.fetchAvailableTags()
      }
      this.getProblemList(this.currentPage, false)
    },
    methods: {
      applyRouteState (route) {
        const query = route.query || {}
        const parsedPage = parseInt(query.page)
        const parsedPageSize = parseInt(query.page_size)

        this.syncingRouteState = true
        this.keyword = query.keyword || ''
        this.currentPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        this.pageSize = this.pageSizes.includes(parsedPageSize) ? parsedPageSize : 10
        this.syncingRouteState = false
      },
      syncRouteQuery () {
        const query = {}
        if (this.keyword) {
          query.keyword = this.keyword
        }
        if (this.currentPage > 1) {
          query.page = String(this.currentPage)
        }
        if (this.pageSize !== 10) {
          query.page_size = String(this.pageSize)
        }

        const currentQuery = this.$route.query || {}
        const queryUnchanged = currentQuery.keyword === query.keyword &&
          currentQuery.page === query.page &&
          currentQuery.page_size === query.page_size &&
          Object.keys(currentQuery).length === Object.keys(query).length

        if (queryUnchanged) {
          return
        }

        this.$router.replace({
          name: this.$route.name,
          params: this.$route.params,
          query: query
        }).catch(() => {})
      },
      handleDblclick (row) {
        row.isEditing = true
      },
      handleSelectionChange (rows) {
        this.selectedProblemIds = rows.map(item => item.id)
      },
      fetchAvailableTags () {
        api.getProblemTagList({include_inactive: true}).then(res => {
          this.availableTags = res.data.data.map(item => item.name)
        }).catch(() => {})
      },
      resetBatchTagsState () {
        this.batchTags = {
          operation: 'replace',
          tags: []
        }
      },
      resetBatchSourceState () {
        this.batchSource = {
          source: ''
        }
      },
      goEdit (problemId) {
        if (this.routeName === 'problem-list') {
          this.$router.push({name: 'edit-problem', params: {problemId}})
        } else if (this.routeName === 'contest-problem-list') {
          this.$router.push({name: 'edit-contest-problem', params: {problemId: problemId, contestId: this.contestId}})
        }
      },
      goCreateProblem () {
        if (this.routeName === 'problem-list') {
          this.$router.push({name: 'create-problem'})
        } else if (this.routeName === 'contest-problem-list') {
          this.$router.push({name: 'create-contest-problem', params: {contestId: this.contestId}})
        }
      },
      // 切换页码回调
      currentChange (page) {
        this.currentPage = page
        this.getProblemList(page)
      },
      handlePageSizeChange (pageSize) {
        this.pageSize = pageSize
        this.currentPage = 1
        this.getProblemList(1)
      },
      getProblemList (page = 1, syncRoute = true) {
        this.currentPage = page
        if (syncRoute) {
          this.syncRouteQuery()
        }
        this.loading = true
        let funcName = this.routeName === 'problem-list' ? 'getProblemList' : 'getContestProblemList'
        let params = {
          limit: this.pageSize,
          offset: (page - 1) * this.pageSize,
          keyword: this.keyword,
          contest_id: this.contestId
        }
        api[funcName](params).then(res => {
          this.loading = false
          this.total = res.data.data.total
          for (let problem of res.data.data.results) {
            problem.isEditing = false
          }
          this.problemList = res.data.data.results
        }, res => {
          this.loading = false
        })
      },
      submitBatchTags () {
        const tags = Array.from(new Set(this.batchTags.tags.map(tag => String(tag).trim()).filter(tag => tag)))
        if (this.batchTags.operation !== 'replace' && tags.length === 0) {
          this.$error('Please select at least one tag')
          return
        }
        api.batchUpdateProblemTags({
          problem_ids: this.selectedProblemIds,
          operation: this.batchTags.operation,
          tags: tags
        }).then(() => {
          this.batchTagsDialogVisible = false
          this.$refs.table.clearSelection()
          this.selectedProblemIds = []
          this.getProblemList(this.currentPage)
        }).catch(() => {})
      },
      submitBatchSource () {
        api.batchUpdateProblemSource({
          problem_ids: this.selectedProblemIds,
          source: this.batchSource.source
        }).then(() => {
          this.batchSourceDialogVisible = false
          this.$refs.table.clearSelection()
          this.selectedProblemIds = []
          this.getProblemList(this.currentPage)
        }).catch(() => {})
      },
      deleteProblem (id) {
        this.$confirm('Sure to delete this problem? The associated submissions will be deleted as well.', 'Delete Problem', {
          type: 'warning'
        }).then(() => {
          let funcName = this.routeName === 'problem-list' ? 'deleteProblem' : 'deleteContestProblem'
          api[funcName](id).then(() => [
            this.getProblemList(Math.max(this.currentPage - 1, 1))
          ]).catch(() => {
          })
        }, () => {
        })
      },
      makeContestProblemPublic (problemID) {
        this.$prompt('Please input display id for the public problem', 'confirm').then(({value}) => {
          api.makeContestProblemPublic({id: problemID, display_id: value}).catch()
        }, () => {
        })
      },
      updateProblem (row) {
        let data = Object.assign({}, row)
        let funcName = ''
        if (this.contestId) {
          data.contest_id = this.contestId
          funcName = 'editContestProblem'
        } else {
          funcName = 'editProblem'
        }
        api[funcName](data).then(res => {
          this.InlineEditDialogVisible = false
          this.getProblemList(this.currentPage)
        }).catch(() => {
          this.InlineEditDialogVisible = false
        })
      },
      handleInlineEdit (row) {
        this.currentRow = row
        this.InlineEditDialogVisible = true
      },
      downloadTestCase (problemID) {
        let url = '/admin/test_case?problem_id=' + problemID
        utils.downloadFile(url)
      },
      getPublicProblem () {
        api.getProblemList()
      }
    },
    watch: {
      '$route' (newVal, oldVal) {
        this.contestId = newVal.params.contestId
        this.routeName = newVal.name
        this.applyRouteState(newVal)
        if (this.isBatchManageEnabled) {
          this.fetchAvailableTags()
        }
        this.getProblemList(this.currentPage, false)
      },
      'keyword' () {
        if (this.syncingRouteState) {
          return
        }
        this.currentPage = 1
        this.getProblemList(1)
      }
    }
  }
</script>

<style scoped lang="less">
  .list-toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .toolbar-toggles {
    display: flex;
    align-items: center;
    gap: 12px;
    white-space: nowrap;
  }

  .tag-list-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .batch-help {
    margin: 8px 0 0;
    color: #909399;
    font-size: 12px;
    line-height: 1.6;
  }
</style>
