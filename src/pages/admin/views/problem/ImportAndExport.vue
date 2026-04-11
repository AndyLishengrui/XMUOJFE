<template>
  <div>
    <div style="padding-bottom: 10px;">
    </div>
    <panel title="Export Problems (beta)">
      <div slot="header">
        <el-input
          v-model="keyword"
          prefix-icon="el-icon-search"
          placeholder="Keywords">
        </el-input>
      </div>
      <el-table :data="problems"
                v-loading="loadingProblems" @selection-change="handleSelectionChange">
        <el-table-column
          type="selection"
          width="60">
        </el-table-column>
        <el-table-column
          label="ID"
          width="100"
          prop="id">
        </el-table-column>
        <el-table-column
          label="DisplayID"
          width="200"
          prop="_id">
        </el-table-column>
        <el-table-column
          label="Title"
          prop="title">
        </el-table-column>
        <el-table-column
          prop="created_by.username"
          label="Author">
        </el-table-column>
        <el-table-column
          prop="create_time"
          label="Create Time">
          <template slot-scope="scope">
            {{scope.row.create_time | localtime }}
          </template>
        </el-table-column>
      </el-table>

      <div class="panel-options">
        <el-button type="primary" size="small" v-show="selected_problems.length"
                   @click="exportProblems" icon="el-icon-fa-arrow-down">Export
        </el-button>
        <el-pagination
          class="page"
          layout="prev, pager, next, sizes"
          @current-change="getProblems"
          @size-change="handlePageSizeChange"
          :current-page="page"
          :page-size="limit"
          :page-sizes="pageSizes"
          :total="total">
        </el-pagination>
      </div>
    </panel>
    <panel title="Import QDUOJ Problems (beta)">
      <el-upload
        ref="QDU"
        action="/api/admin/import_problem"
        name="file"
        :file-list="fileList1"
        :show-file-list="true"
        :with-credentials="true"
        :limit="3"
        :on-change="onFile1Change"
        :auto-upload="false"
        :on-success="uploadSucceeded"
        :on-error="uploadFailed">
        <el-button size="small" type="primary" icon="el-icon-fa-upload" slot="trigger">Choose File</el-button>
        <el-button style="margin-left: 10px;" size="small" type="success" @click="submitUpload('QDU')">Upload</el-button>
      </el-upload>
    </panel>

    <panel title="Import FPS Problems (beta)">
      <el-upload
        ref="FPS"
        action="/api/admin/import_fps"
        name="file"
        :file-list="fileList2"
        :show-file-list="true"
        :with-credentials="true"
        :limit="3"
        :on-change="onFile2Change"
        :auto-upload="false"
        :on-success="uploadSucceeded"
        :on-error="uploadFailed">
        <el-button size="small" type="primary" icon="el-icon-fa-upload" slot="trigger">Choose File</el-button>
        <el-button style="margin-left: 10px;" size="small" type="success" @click="submitUpload('FPS')">Upload</el-button>
      </el-upload>
    </panel>
  </div>
</template>
<script>
  import api from '@admin/api'
  import utils from '@/utils/utils'

  export default {
    name: 'import_and_export',
    data () {
      return {
        fileList1: [],
        fileList2: [],
        page: 1,
        limit: 10,
        pageSizes: [10, 30, 50, 100, 200],
        total: 0,
        loadingProblems: false,
        loadingImporting: false,
        keyword: '',
        problems: [],
        selected_problems: [],
        syncingRouteState: false
      }
    },
    mounted () {
      this.applyRouteState(this.$route)
      this.getProblems(this.page, false)
    },
    methods: {
      applyRouteState (route) {
        const query = route.query || {}
        const parsedPage = parseInt(query.page)
        const parsedLimit = parseInt(query.page_size)

        this.syncingRouteState = true
        this.keyword = query.keyword || ''
        this.page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
        this.limit = this.pageSizes.includes(parsedLimit) ? parsedLimit : 10
        this.syncingRouteState = false
      },
      syncRouteQuery () {
        const query = {}
        if (this.keyword) {
          query.keyword = this.keyword
        }
        if (this.page > 1) {
          query.page = String(this.page)
        }
        if (this.limit !== 10) {
          query.page_size = String(this.limit)
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
      handleSelectionChange (val) {
        this.selected_problems = val
      },
      getProblems (page = 1, syncRoute = true) {
        this.page = page
        if (syncRoute) {
          this.syncRouteQuery()
        }
        let params = {
          keyword: this.keyword,
          offset: (page - 1) * this.limit,
          limit: this.limit
        }
        this.loadingProblems = true
        api.getProblemList(params).then(res => {
          this.problems = res.data.data.results
          this.total = res.data.data.total
          this.loadingProblems = false
        })
      },
      handlePageSizeChange (pageSize) {
        this.limit = pageSize
        this.page = 1
        this.getProblems(1)
      },
      exportProblems () {
        let params = []
        for (let p of this.selected_problems) {
          params.push('problem_id=' + p.id)
        }
        let url = '/admin/export_problem?' + params.join('&')
        utils.downloadFile(url)
      },
      submitUpload (ref) {
        this.$refs[ref].submit()
      },
      onFile1Change (file, fileList) {
        this.fileList1 = fileList.slice(-1)
      },
      onFile2Change (file, fileList) {
        this.fileList2 = fileList.slice(-1)
      },
      uploadSucceeded (response) {
        if (response.error) {
          this.$error(response.data)
        } else {
          this.$success('Successfully imported ' + response.data.import_count + ' problems')
          this.getProblems()
        }
      },
      uploadFailed () {
        this.$error('Upload failed')
      }
    },
    watch: {
      '$route' (newVal) {
        this.applyRouteState(newVal)
        this.getProblems(this.page, false)
      },
      'keyword' () {
        if (this.syncingRouteState) {
          return
        }
        this.page = 1
        this.getProblems(1)
      }
    }
  }
</script>

<style scoped lang="less">

</style>
