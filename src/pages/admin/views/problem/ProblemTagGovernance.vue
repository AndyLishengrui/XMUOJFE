<template>
  <div class="view">
    <Panel :title="$t('m.Problem_Tag_Governance')">
      <div slot="header" class="toolbar">
        <el-input
          v-model="filters.keyword"
          clearable
          prefix-icon="el-icon-search"
          :placeholder="$t('m.Problem_Tag_Search_Placeholder')"
          @keyup.enter.native="fetchTags">
        </el-input>
      </div>

      <div class="filter-row">
        <el-switch
          v-model="filters.includeInactive"
          :active-text="$t('m.Problem_Tag_Show_Inactive')"
          @change="fetchTags">
        </el-switch>
        <el-switch
          v-model="filters.onlyUsed"
          :active-text="$t('m.Problem_Tag_Only_Used')"
          @change="fetchTags">
        </el-switch>
        <el-button type="primary" icon="el-icon-search" @click="fetchTags">{{$t('m.Problem_Tag_Refresh')}}</el-button>
        <el-button type="success" icon="el-icon-plus" @click="openCreateDialog">{{$t('m.Problem_Tag_Create')}}</el-button>
        <el-button v-if="isSuperAdmin" type="danger" plain :disabled="selectedTags.length === 0" @click="confirmBatchDelete">Batch Delete</el-button>
        <el-button v-if="isSuperAdmin" type="warning" plain :disabled="selectedTags.length === 0" @click="batchDialogVisible = true">Batch Update</el-button>
      </div>

      <el-table
        v-loading="loading.tags"
        :data="tagList"
        @selection-change="handleSelectionChange"
        style="width: 100%">
        <el-table-column v-if="isSuperAdmin" type="selection" width="55"></el-table-column>
        <el-table-column width="80" prop="id" label="ID"></el-table-column>
        <el-table-column min-width="160" :label="$t('m.Name')" prop="name"></el-table-column>
        <el-table-column min-width="160" :label="$t('m.Problem_Tag_Normalized_Name')" prop="normalized_name"></el-table-column>
        <el-table-column min-width="220" :label="$t('m.Problem_Tag_Aliases')">
          <template slot-scope="{row}">
            <span v-if="!row.aliases || row.aliases.length === 0">-</span>
            <div v-else class="tag-chip-list">
              <el-tag v-for="alias in row.aliases" :key="row.id + '-' + alias" size="mini">{{ alias }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column width="110" :label="$t('m.Problem_Tag_Problem_Count')" prop="problem_count"></el-table-column>
        <el-table-column width="100" :label="$t('m.Problem_Tag_Rank')" prop="rank"></el-table-column>
        <el-table-column width="120" :label="$t('m.Visible')">
          <template slot-scope="{row}">
            <el-switch :value="row.is_active" @change="toggleActive(row, $event)"></el-switch>
          </template>
        </el-table-column>
        <el-table-column min-width="200" :label="$t('m.Description')" prop="description">
          <template slot-scope="{row}">
            <span>{{ row.description || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column width="120" :label="$t('m.Problem_Tag_Action')" fixed="right">
          <template slot-scope="{row}">
            <el-button type="text" @click="openEditDialog(row)">{{$t('m.Problem_Tag_Edit')}}</el-button>
            <el-button type="text" class="danger-text" @click="confirmDelete(row)">{{$t('m.Problem_Tag_Delete')}}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </Panel>

    <Panel :title="$t('m.Problem_Tag_Audit_Title')">
      <div slot="header" class="toolbar audit-toolbar">
        <span class="threshold-label">{{$t('m.Problem_Tag_Low_Frequency_Threshold')}}</span>
        <el-input-number v-model="auditThreshold" :min="1" :max="20"></el-input-number>
        <el-button type="primary" icon="el-icon-refresh" @click="fetchAudit">{{$t('m.Problem_Tag_Refresh_Audit')}}</el-button>
      </div>

      <el-row :gutter="16" class="summary-row">
        <el-col :span="6" v-for="item in summaryCards" :key="item.key">
          <div class="summary-card">
            <div class="summary-label">{{ item.label }}</div>
            <div class="summary-value">{{ item.value }}</div>
          </div>
        </el-col>
      </el-row>

      <el-collapse v-model="activeAuditSections" class="audit-collapse">
        <el-collapse-item name="duplicates" :title="$t('m.Problem_Tag_Duplicate_Groups') + ' (' + audit.duplicates.length + ')'">
          <el-table :data="audit.duplicates" size="small" v-loading="loading.audit" empty-text="No data">
            <el-table-column min-width="180" :label="$t('m.Problem_Tag_Normalized_Name')" prop="normalized_name"></el-table-column>
            <el-table-column min-width="420" :label="$t('m.Problem_Tag_Duplicate_Items')">
              <template slot-scope="{row}">
                <div class="audit-tag-group">
                  <div v-for="tag in row.tags" :key="tag.id" class="audit-tag-item">
                    <el-tag :type="tag.is_active ? 'success' : 'info'" size="mini">{{ tag.name }}</el-tag>
                    <span class="audit-meta">#{{ tag.id }} / {{ tag.problem_count }}</span>
                    <el-button type="text" @click="openEditById(tag.id)">{{$t('m.Problem_Tag_Edit')}}</el-button>
                    <el-button type="text" class="danger-text" @click="confirmDeleteById(tag.id)">{{$t('m.Problem_Tag_Delete')}}</el-button>
                  </div>
                </div>
              </template>
            </el-table-column>
            <el-table-column width="120" :label="$t('m.Problem_Tag_Action')">
              <template slot-scope="{row}">
                <el-button type="text" @click="openMergeDialog(row)">{{$t('m.Problem_Tag_Merge')}}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>

        <el-collapse-item name="zero" :title="$t('m.Problem_Tag_Zero_Problem') + ' (' + audit.zero_problem_tags.length + ')'">
          <el-table :data="audit.zero_problem_tags" size="small" v-loading="loading.audit" empty-text="No data">
            <el-table-column width="90" prop="id" label="ID"></el-table-column>
            <el-table-column min-width="240" :label="$t('m.Name')" prop="name"></el-table-column>
            <el-table-column width="120" :label="$t('m.Problem_Tag_Action')">
              <template slot-scope="{row}">
                <el-button type="text" @click="openEditById(row.id)">{{$t('m.Problem_Tag_Edit')}}</el-button>
                <el-button type="text" class="danger-text" @click="confirmDeleteById(row.id)">{{$t('m.Problem_Tag_Delete')}}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>

        <el-collapse-item name="low" :title="$t('m.Problem_Tag_Low_Frequency') + ' (' + audit.low_frequency_tags.length + ')'">
          <el-table :data="audit.low_frequency_tags" size="small" v-loading="loading.audit" empty-text="No data">
            <el-table-column width="90" prop="id" label="ID"></el-table-column>
            <el-table-column min-width="220" :label="$t('m.Name')" prop="name"></el-table-column>
            <el-table-column width="120" :label="$t('m.Problem_Tag_Problem_Count')" prop="problem_count"></el-table-column>
            <el-table-column width="120" :label="$t('m.Problem_Tag_Action')">
              <template slot-scope="{row}">
                <el-button type="text" @click="openEditById(row.id)">{{$t('m.Problem_Tag_Edit')}}</el-button>
                <el-button type="text" class="danger-text" @click="confirmDeleteById(row.id)">{{$t('m.Problem_Tag_Delete')}}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>

        <el-collapse-item name="conflicts" :title="$t('m.Problem_Tag_Alias_Conflicts') + ' (' + audit.alias_conflicts.length + ')'">
          <el-table :data="audit.alias_conflicts" size="small" v-loading="loading.audit" empty-text="No data">
            <el-table-column min-width="200" :label="$t('m.Problem_Tag_Normalized_Name')" prop="normalized_name"></el-table-column>
            <el-table-column min-width="300" :label="$t('m.Problem_Tag_Conflict_Tags')">
              <template slot-scope="{row}">
                <div class="tag-chip-list">
                  <el-tag v-for="tagId in row.tag_ids" :key="row.normalized_name + '-' + tagId" size="mini">#{{ tagId }}</el-tag>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </Panel>

    <el-dialog
      :title="editingTag.id ? $t('m.Problem_Tag_Edit_Title') : $t('m.Problem_Tag_Create_Title')"
      width="680px"
      :visible.sync="dialogVisible"
      @close="resetEditingTag">
      <el-form label-position="left" label-width="110px" :model="editingTag">
        <el-form-item :label="$t('m.Name')" required>
          <el-input v-model="editingTag.name"></el-input>
        </el-form-item>
        <el-form-item :label="$t('m.Problem_Tag_Aliases')">
          <el-input
            type="textarea"
            :rows="3"
            v-model="editingTag.aliasesText"
            :placeholder="$t('m.Problem_Tag_Aliases_Placeholder')">
          </el-input>
        </el-form-item>
        <el-form-item :label="$t('m.Problem_Tag_Rank')">
          <el-input-number v-model="editingTag.rank" :min="0" :max="9999"></el-input-number>
        </el-form-item>
        <el-form-item :label="$t('m.Visible')">
          <el-switch v-model="editingTag.is_active"></el-switch>
        </el-form-item>
        <el-form-item :label="$t('m.Description')">
          <el-input type="textarea" :rows="4" v-model="editingTag.description"></el-input>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <el-button
          v-if="editingTag.id"
          type="danger"
          plain
          :loading="loading.save"
          @click="confirmDelete(editingTag)">{{$t('m.Problem_Tag_Delete')}}</el-button>
        <cancel @click.native="dialogVisible = false"></cancel>
        <save @click.native="saveTag"></save>
      </span>
    </el-dialog>

    <el-dialog
      :title="$t('m.Problem_Tag_Merge_Title')"
      width="720px"
      :visible.sync="mergeDialogVisible"
      @close="resetMergeState">
      <div v-if="mergeGroup.tags.length">
        <el-alert :title="$t('m.Problem_Tag_Merge_Help')" type="warning" :closable="false"></el-alert>
        <el-form label-position="top" class="merge-form">
          <el-form-item :label="$t('m.Problem_Tag_Merge_Target')">
            <el-radio-group v-model="mergeTargetId">
              <el-radio v-for="tag in mergeGroup.tags" :key="'merge-target-' + tag.id" :label="tag.id">
                {{ tag.name }} (#{{ tag.id }}) / {{ tag.problem_count }}
              </el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="$t('m.Problem_Tag_Merge_Sources')">
            <el-checkbox-group v-model="mergeSourceIds">
              <el-checkbox v-for="tag in mergeCandidates" :key="'merge-source-' + tag.id" :label="tag.id">
                {{ tag.name }} (#{{ tag.id }}) / {{ tag.problem_count }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
        </el-form>
      </div>
      <span slot="footer">
        <cancel @click.native="mergeDialogVisible = false"></cancel>
        <save @click.native="submitMerge"></save>
      </span>
    </el-dialog>

    <el-dialog
      title="Batch Update Tags"
      width="520px"
      :visible.sync="batchDialogVisible"
      @close="resetBatchState">
      <el-form label-position="top">
        <el-form-item label="Selected Tags">
          <div class="tag-chip-list">
            <el-tag v-for="tag in selectedTags" :key="'selected-tag-' + tag.id" size="mini">{{ tag.name }} (#{{ tag.id }})</el-tag>
          </div>
        </el-form-item>
        <el-form-item label="Rank">
          <el-switch v-model="batchUpdate.includeRank"></el-switch>
          <el-input-number v-if="batchUpdate.includeRank" v-model="batchUpdate.rank" :min="0" :max="9999" style="margin-left: 12px;"></el-input-number>
        </el-form-item>
        <el-form-item label="Visible">
          <el-switch v-model="batchUpdate.includeIsActive"></el-switch>
          <el-radio-group v-if="batchUpdate.includeIsActive" v-model="batchUpdate.is_active" style="margin-left: 12px;">
            <el-radio :label="true">Active</el-radio>
            <el-radio :label="false">Inactive</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Description">
          <el-switch v-model="batchUpdate.includeDescription"></el-switch>
          <el-input v-if="batchUpdate.includeDescription" type="textarea" :rows="3" v-model="batchUpdate.description" placeholder="Leave empty to clear description" style="margin-top: 12px;"></el-input>
        </el-form-item>
      </el-form>
      <span slot="footer">
        <cancel @click.native="batchDialogVisible = false"></cancel>
        <save @click.native="submitBatchUpdate"></save>
      </span>
    </el-dialog>
  </div>
</template>

<script>
  import api from '../../api'

  function createEmptyTag () {
    return {
      id: null,
      name: '',
      aliasesText: '',
      rank: 0,
      is_active: true,
      description: ''
    }
  }

  export default {
    name: 'ProblemTagGovernance',
    data () {
      return {
        loading: {
          tags: false,
          audit: false,
          save: false
        },
        filters: {
          keyword: '',
          includeInactive: true,
          onlyUsed: false
        },
        tagList: [],
        tagLookup: {},
        selectedTags: [],
        auditThreshold: 2,
        audit: {
          summary: {
            total_tags: 0,
            active_tags: 0,
            duplicate_groups: 0,
            zero_problem_tags: 0,
            low_frequency_tags: 0
          },
          duplicates: [],
          zero_problem_tags: [],
          low_frequency_tags: [],
          alias_conflicts: []
        },
        activeAuditSections: ['duplicates', 'zero', 'low'],
        dialogVisible: false,
        editingTag: createEmptyTag(),
        mergeDialogVisible: false,
        batchDialogVisible: false,
        batchUpdate: {
          includeRank: false,
          rank: 0,
          includeIsActive: false,
          is_active: true,
          includeDescription: false,
          description: ''
        },
        mergeGroup: {
          normalized_name: '',
          tags: []
        },
        mergeTargetId: null,
        mergeSourceIds: []
      }
    },
    computed: {
      isSuperAdmin () {
        return this.$store.getters.isSuperAdmin
      },
      summaryCards () {
        return [
          {key: 'total', label: this.$t('m.Problem_Tag_Total'), value: this.audit.summary.total_tags},
          {key: 'active', label: this.$t('m.Problem_Tag_Active'), value: this.audit.summary.active_tags},
          {key: 'duplicates', label: this.$t('m.Problem_Tag_Duplicate_Summary'), value: this.audit.summary.duplicate_groups},
          {key: 'zero', label: this.$t('m.Problem_Tag_Zero_Summary'), value: this.audit.summary.zero_problem_tags}
        ]
      },
      mergeCandidates () {
        return this.mergeGroup.tags.filter(tag => tag.id !== this.mergeTargetId)
      }
    },
    mounted () {
      this.fetchAll()
    },
    methods: {
      fetchAll () {
        this.fetchTags()
        this.fetchAudit()
      },
      fetchTags () {
        this.loading.tags = true
        return api.getProblemTagList({
          keyword: this.filters.keyword,
          include_inactive: this.filters.includeInactive,
          only_used: this.filters.onlyUsed
        }).then(res => {
          this.tagList = res.data.data
          const selectedIdSet = new Set(this.selectedTags.map(item => item.id))
          this.selectedTags = this.tagList.filter(item => selectedIdSet.has(item.id))
          this.tagLookup = this.tagList.reduce((lookup, item) => {
            lookup[item.id] = item
            return lookup
          }, {})
          this.loading.tags = false
        }).catch(() => {
          this.loading.tags = false
        })
      },
      handleSelectionChange (rows) {
        this.selectedTags = rows
      },
      fetchAudit () {
        this.loading.audit = true
        api.getProblemTagAudit({
          low_frequency_threshold: this.auditThreshold
        }).then(res => {
          this.audit = res.data.data
          this.loading.audit = false
        }).catch(() => {
          this.loading.audit = false
        })
      },
      normalizeAliasesText (aliases) {
        return (aliases || []).join('\n')
      },
      parseAliases (aliasesText) {
        return (aliasesText || '')
          .split(/[\n,，]/)
          .map(item => item.trim())
          .filter(item => item)
      },
      openCreateDialog () {
        this.editingTag = createEmptyTag()
        this.dialogVisible = true
      },
      openEditDialog (row) {
        this.editingTag = {
          id: row.id,
          name: row.name,
          aliasesText: this.normalizeAliasesText(row.aliases),
          rank: row.rank || 0,
          is_active: row.is_active,
          description: row.description || ''
        }
        this.dialogVisible = true
      },
      openEditById (tagId) {
        this.loading.save = true
        api.getProblemTag(tagId).then(res => {
          this.loading.save = false
          this.openEditDialog(res.data.data)
        }).catch(() => {
          this.loading.save = false
        })
      },
      resetEditingTag () {
        this.editingTag = createEmptyTag()
      },
      openMergeDialog (group) {
        this.mergeGroup = group
        const sortedTags = group.tags.slice().sort((left, right) => {
          if (right.problem_count !== left.problem_count) {
            return right.problem_count - left.problem_count
          }
          return left.id - right.id
        })
        this.mergeTargetId = sortedTags[0] ? sortedTags[0].id : null
        this.mergeSourceIds = sortedTags.slice(1).map(tag => tag.id)
        this.mergeDialogVisible = true
      },
      resetMergeState () {
        this.mergeGroup = {
          normalized_name: '',
          tags: []
        }
        this.mergeTargetId = null
        this.mergeSourceIds = []
      },
      resetBatchState () {
        this.batchUpdate = {
          includeRank: false,
          rank: 0,
          includeIsActive: false,
          is_active: true,
          includeDescription: false,
          description: ''
        }
      },
      saveTag () {
        const payload = {
          name: (this.editingTag.name || '').trim(),
          aliases: this.parseAliases(this.editingTag.aliasesText),
          rank: this.editingTag.rank,
          is_active: this.editingTag.is_active,
          description: this.editingTag.description
        }
        if (!payload.name) {
          this.$error(this.$t('m.Problem_Tag_Name_Required'))
          return
        }
        this.loading.save = true
        const request = this.editingTag.id
          ? api.updateProblemTag(Object.assign({id: this.editingTag.id}, payload))
          : api.createProblemTag(payload)
        request.then(() => {
          this.loading.save = false
          this.dialogVisible = false
          this.fetchAll()
          this.$success(this.$t('m.Problem_Tag_Save_Success'))
        }).catch(() => {
          this.loading.save = false
        })
      },
      confirmDeleteById (tagId) {
        this.loading.save = true
        api.getProblemTag(tagId).then(res => {
          this.loading.save = false
          this.confirmDelete(res.data.data)
        }).catch(() => {
          this.loading.save = false
        })
      },
      confirmDelete (tag) {
        const problemCount = tag.problem_count || 0
        const tagLabel = `${tag.name || ('#' + tag.id)} (#${tag.id})`
        this.$confirm(
          `${this.$t('m.Problem_Tag_Delete_Confirm')}\n${tagLabel}\n${this.$t('m.Problem_Tag_Delete_Impact')} ${problemCount}`,
          this.$t('m.Problem_Tag_Delete_Title'),
          {type: 'warning'}
        ).then(() => {
          this.loading.save = true
          api.deleteProblemTag(tag.id).then(() => {
            this.loading.save = false
            this.dialogVisible = false
            this.fetchAll()
            this.$success(this.$t('m.Problem_Tag_Delete_Success'))
          }).catch(() => {
            this.loading.save = false
          })
        }).catch(() => {})
      },
      confirmBatchDelete () {
        const count = this.selectedTags.length
        this.$confirm(`Delete ${count} selected tags? Problems left without tags will automatically get toTag.`, 'Batch Delete Tags', {
          type: 'warning'
        }).then(() => {
          api.batchDeleteProblemTag({
            tag_ids: this.selectedTags.map(item => item.id)
          }).then(() => {
            this.selectedTags = []
            this.fetchAll()
          }).catch(() => {})
        }).catch(() => {})
      },
      submitBatchUpdate () {
        const payload = {
          tag_ids: this.selectedTags.map(item => item.id)
        }
        if (this.batchUpdate.includeRank) {
          payload.rank = this.batchUpdate.rank
        }
        if (this.batchUpdate.includeIsActive) {
          payload.is_active = this.batchUpdate.is_active
        }
        if (this.batchUpdate.includeDescription) {
          payload.description = this.batchUpdate.description
        }
        if (Object.keys(payload).length === 1) {
          this.$error('Please choose at least one field to update')
          return
        }
        api.batchUpdateProblemTag(payload).then(() => {
          this.batchDialogVisible = false
          this.selectedTags = []
          this.fetchAll()
        }).catch(() => {})
      },
      submitMerge () {
        if (!this.mergeTargetId || this.mergeSourceIds.length === 0) {
          this.$error(this.$t('m.Problem_Tag_Merge_Invalid'))
          return
        }
        api.mergeProblemTag({
          target_tag_id: this.mergeTargetId,
          source_tag_ids: this.mergeSourceIds
        }).then(() => {
          this.mergeDialogVisible = false
          this.fetchAll()
          this.$success(this.$t('m.Problem_Tag_Merge_Success'))
        }).catch(() => {})
      },
      toggleActive (row, nextValue) {
        const originalValue = row.is_active
        row.is_active = nextValue
        api.updateProblemTag({
          id: row.id,
          name: row.name,
          aliases: row.aliases || [],
          rank: row.rank,
          is_active: row.is_active,
          description: row.description
        }).then(() => {
          this.fetchAudit()
        }).catch(() => {
          row.is_active = originalValue
        })
      }
    }
  }
</script>

<style scoped lang="less">
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }

  .audit-toolbar {
    justify-content: flex-end;
  }

  .threshold-label {
    color: #606266;
    font-size: 13px;
  }

  .summary-row {
    margin-bottom: 18px;
  }

  .summary-card {
    border: 1px solid #ebeef5;
    border-radius: 6px;
    padding: 16px;
    background: #fafafa;
  }

  .summary-label {
    color: #909399;
    font-size: 13px;
    margin-bottom: 8px;
  }

  .summary-value {
    color: #303133;
    font-size: 26px;
    font-weight: 600;
    line-height: 1;
  }

  .audit-collapse {
    margin-top: 10px;
  }

  .tag-chip-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .audit-tag-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .audit-tag-item {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .audit-meta {
    color: #909399;
    font-size: 12px;
  }

  .merge-form {
    margin-top: 16px;
  }

  .danger-text {
    color: #f56c6c;
  }
</style>