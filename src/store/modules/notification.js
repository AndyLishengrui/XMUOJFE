import Vue from 'vue'
import types from '../types'

const state = {
  unreadCount: 0,
  notifications: []
}

const getters = {
  unreadCount: state => state.unreadCount,
  notifications: state => state.notifications
}

const mutations = {
  [types.CHANGE_NOTIF_UNREAD] (state, {unreadCount}) {
    state.unreadCount = unreadCount
  },
  [types.CHANGE_NOTIF_LIST] (state, {notifications}) {
    state.notifications = notifications
  }
}

// Use $http (axios) directly to avoid webpack lazy-chunk issues
function notifAjax (url, method, paramsOrData) {
  const options = { url: '/api/' + url, method }
  if (method === 'get' || method === 'delete') {
    options.params = paramsOrData || {}
  } else {
    options.data = paramsOrData || {}
  }
  return Vue.prototype.$http(options).then(res => {
    if (res.data.error !== null) {
      Vue.prototype.$error(res.data.data)
      return Promise.reject(res)
    }
    return res
  }, res => {
    Vue.prototype.$error(res.data.data)
    return Promise.reject(res)
  })
}

const actions = {
  fetchUnreadCount ({commit}) {
    notifAjax('notifications/unread_count', 'get').then(res => {
      commit(types.CHANGE_NOTIF_UNREAD, {
        unreadCount: res.data.data.unread_count
      })
    })
  },
  fetchNotifications ({commit}) {
    notifAjax('notifications', 'get', {offset: 0, limit: 5}).then(res => {
      commit(types.CHANGE_NOTIF_LIST, {
        notifications: res.data.data.results || []
      })
    })
  },
  markNotifRead ({commit}, notifId) {
    return notifAjax('notifications/read', 'post', {id: notifId})
  },
  deleteNotif ({commit}, notifId) {
    return notifAjax('notifications/delete', 'delete', {id: notifId})
  },
  batchMarkRead () {
    return notifAjax('notifications/batch_read', 'post')
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
