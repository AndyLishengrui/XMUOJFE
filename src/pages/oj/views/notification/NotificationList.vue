<template>
  <div class="notification-container">
    <Card :padding="20">
      <div class="notif-header">
        <h2>{{ $t('m.Notifications') }}</h2>
        <Button v-if="unreadCount > 0" type="primary" size="small" @click="markAllRead">
          {{ $t('m.MarkAllRead') }}
        </Button>
      </div>
      <div v-if="loading" style="text-align:center;padding:40px;">
        <Spin size="large"></Spin>
      </div>
      <div v-else-if="notificationList.length === 0" style="text-align:center;padding:40px;color:#999;">
        {{ $t('m.NoNotifications') }}
      </div>
      <div v-else>
        <div v-for="n in notificationList" :key="n.id" class="notif-row"
             :class="{ 'notif-unread': !n.is_read }"
             @click="goNotification(n)">
          <div class="notif-dot">
            <span v-if="!n.is_read" class="dot"></span>
          </div>
          <div class="notif-body">
            <div class="notif-title">{{ n.title }}</div>
            <div class="notif-content" v-if="n.content">{{ n.content }}</div>
            <div class="notif-meta">
              <span v-if="n.sender_name" class="notif-sender">{{ n.sender_name }}</span>
              <span class="notif-time">{{ n.create_time | localtime }}</span>
            </div>
          </div>
          <div class="notif-actions" @click.stop>
            <Button type="text" size="small" @click="deleteItem(n.id)">
              <Icon type="ios-trash-outline" size="18"></Icon>
            </Button>
          </div>
        </div>
        <div class="notif-pager" v-if="total > pageSize">
          <Page :total="total" :page-size="pageSize" :current="page" @on-change="changePage" size="small"></Page>
        </div>
      </div>
    </Card>
  </div>
</template>

<script>
import { mapGetters, mapActions } from 'vuex'

export default {
  name: 'NotificationList',
  data () {
    return {
      loading: false,
      notificationList: [],
      page: 1,
      pageSize: 20,
      total: 0
    }
  },
  computed: {
    ...mapGetters(['unreadCount'])
  },
  mounted () {
    this.loadNotifications()
  },
  methods: {
    ...mapActions(['markNotifRead', 'deleteNotif', 'batchMarkRead', 'fetchUnreadCount']),
    loadNotifications () {
      this.loading = true
      const offset = (this.page - 1) * this.pageSize
      this.$http.get('/api/notifications/', {params: {offset, limit: this.pageSize}})
        .then(res => {
          if (res.data.error === null) {
            this.notificationList = res.data.data.results || []
            this.total = res.data.data.total || 0
          }
        })
        .finally(() => { this.loading = false })
    },
    goNotification (n) {
      if (!n.is_read) {
        this.markNotifRead(n.id).then(() => {
          this.fetchUnreadCount()
          n.is_read = true
        })
      }
      if (n.link && n.link.startsWith('/')) {
        this.$router.push(n.link)
      }
    },
    deleteItem (id) {
      this.deleteNotif(id).then(() => {
        this.notificationList = this.notificationList.filter(item => item.id !== id)
        this.total -= 1
        this.fetchUnreadCount()
      })
    },
    markAllRead () {
      this.batchMarkRead().then(() => {
        this.notificationList.forEach(n => { n.is_read = true })
        this.fetchUnreadCount()
        this.$success(this.$t('m.Succeeded'))
      })
    },
    changePage (p) {
      this.page = p
      this.loadNotifications()
    }
  }
}
</script>

<style lang="less" scoped>
.notification-container {
  max-width: 800px;
  margin: 0 auto;
  .notif-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 16px;
    h2 { margin: 0; font-size: 20px; }
  }
  .notif-row {
    display: flex; align-items: center; padding: 12px 8px;
    border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background .2s;
    &:hover { background: #fafafa; }
    &.notif-unread { background: #f0f7ff; }
    .notif-dot { width: 24px; flex-shrink: 0;
      .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #2d8cf0; }
    }
    .notif-body { flex: 1; min-width: 0;
      .notif-title { font-weight: 500; font-size: 15px; }
      .notif-content { color: #666; font-size: 13px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .notif-meta { margin-top: 6px; font-size: 12px; color: #999;
        .notif-sender { margin-right: 12px; }
      }
    }
    .notif-actions { flex-shrink: 0; margin-left: 12px; }
  }
  .notif-pager { margin-top: 16px; text-align: center; }
}
</style>
