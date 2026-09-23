import { mapGetters } from 'vuex'

export default {
  data () {
    return {
      _showRealName: false
    }
  },
  computed: {
    ...mapGetters(['isSuperAdmin']),
    showRealName: {
      get () {
        return this._showRealName
      },
      set (value) {
        this._showRealName = value
        if (value) {
          this.columns.splice(2, 0, {
            title: this.$t('m.RealName'),
            align: 'center',
            width: 120,
            render: (h, {row}) => {
              return h('span', row.real_name)
            }
          })
        } else {
          this.columns.splice(2, 1)
        }
      }
    }
  }
}
