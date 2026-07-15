<template>
  <div class="notification-admin view">
    <!-- Send Form -->
    <Panel :title="$t('m.Send_Notification')" style="margin-bottom:20px;">
      <el-form label-position="top" style="max-width:600px;">
        <el-form-item :label="$t('m.Recipients')" required>
          <el-select
            v-model="form.recipients"
            multiple filterable remote reserve-keyword
            :placeholder="$t('m.Search_User')"
            :remote-method="searchUsers"
            :loading="searchLoading"
            style="width:100%"
            value-key="username">
            <el-option v-for="u in userOptions" :key="u.username"
              :label="`${u.username} (${u.real_name || ''})`" :value="u.username">
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('m.Notification_Title')" required>
          <el-input v-model="form.title" :placeholder="$t('m.Title_Placeholder')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('m.Content')">
          <el-input v-model="form.content" type="textarea" :rows="2"
            :placeholder="$t('m.Content_Placeholder')"></el-input>
        </el-form-item>
        <el-form-item :label="$t('m.Link')">
          <el-input v-model="form.link" placeholder="/status/abc123"></el-input>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="sendNotification" :loading="sending">
            {{ $t('m.Send') }}
          </el-button>
        </el-form-item>
      </el-form>
    </Panel>

    <!-- Sent List -->
    <Panel :title="$t('m.Sent_Notifications')">
      <el-table v-loading="loading" :data="sentList" style="width:100%">
        <el-table-column prop="id" label="ID" width="70"></el-table-column>
        <el-table-column prop="title" :label="$t('m.Notification_Title')"></el-table-column>
        <el-table-column :label="$t('m.Recipient')" width="130">
          <template slot-scope="scope">
            {{ scope.row.recipient_name || scope.row.recipient }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('m.Status')" width="70">
          <template slot-scope="scope">
            <el-tag :type="scope.row.is_read ? 'success' : 'warning'" size="small">
              {{ scope.row.is_read ? $t('m.Read') : $t('m.Unread') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('m.Create_Time')" width="160">
          <template slot-scope="scope">
            {{ scope.row.create_time | localtime }}
          </template>
        </el-table-column>
      </el-table>
      <div class="panel-options">
        <el-button size="small" icon="el-icon-refresh" @click="loadSentNotifications">刷新</el-button>
        <el-pagination
          class="page" layout="prev, pager, next"
          @current-change="currentChange"
          :current-page="currentPage" :page-size="pageSize" :total="total">
        </el-pagination>
      </div>
    </Panel>
  </div>
</template>

<script>
import api from '../../api'

export default {
  name: 'NotificationAdmin',
  data () {
    return {
      form: { recipients: [], title: '', content: '', link: '' },
      userOptions: [],
      searchLoading: false,
      sending: false,
      loading: false,
      sentList: [],
      currentPage: 1,
      pageSize: 20,
      total: 0
    }
  },
  mounted () {
    this.loadSentNotifications()
  },
  methods: {
    searchUsers (query) {
      if (!query) { this.userOptions = []; return }
      this.searchLoading = true
      api.getUserList(0, 20, query).then(res => {
        this.userOptions = (res.data.data.results || []).map(u => ({
          username: u.username,
          real_name: u.real_name
        }))
      }).finally(() => { this.searchLoading = false })
    },
    sendNotification () {
      if (!this.form.recipients.length || !this.form.title) {
        this.$error(this.$t('m.Fill_Required'))
        return
      }
      this.sending = true
      api.sendNotification({
        recipients: this.form.recipients,
        title: this.form.title,
        content: this.form.content,
        link: this.form.link
      }).then(res => {
        const data = res.data.data
        this.$success(`${this.$t('m.Sent_successfully')}: ${data.sent}`)
        if (data.not_found && data.not_found.length) {
          this.$error(`${this.$t('m.Not_found')}: ${data.not_found.join(', ')}`)
        }
        this.form = { recipients: [], title: '', content: '', link: '' }
        this.userOptions = []
        // Auto-refresh list after send
        this.currentPage = 1
        this.loadSentNotifications()
      }).finally(() => { this.sending = false })
    },
    loadSentNotifications () {
      this.loading = true
      api.getSentNotifications((this.currentPage - 1) * this.pageSize, this.pageSize).then(res => {
        this.sentList = res.data.data.results || []
        this.total = res.data.data.total || 0
      }).finally(() => { this.loading = false })
    },
    currentChange (page) {
      this.currentPage = page
      this.loadSentNotifications()
    }
  }
}
</script>

<style lang="less" scoped>
.notification-admin {
  .panel-options {
    margin-top: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
