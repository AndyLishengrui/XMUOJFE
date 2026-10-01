<template>
  <div class="page" v-show="showBar">
    <Page :total="total"
          :page-size="pageSize"
          @on-change="onChange"
          @on-page-size-change="onPageSizeChange"
          :show-sizer="showSizer"
          :page-size-opts="pageSizeOpts"
          :current="current"></Page>
  </div>
</template>

<script>
  import { PAGE_SIZE_OPTS, DEFAULT_PAGE_SIZE } from '@/utils/constants'

  export default {
    name: 'pagination',
    props: {
      total: {
        required: true,
        type: Number
      },
      pageSize: {
        required: false,
        type: Number
      },
      showSizer: {
        required: false,
        type: Boolean,
        default: false
      },
      // 每页条数可选项 —— 提成 prop，这样个别页面可以按自己的数据密度定制。
      // 默认值就是全站统一的那四档（见 utils/constants.js）。
      pageSizeOpts: {
        required: false,
        type: Array,
        default: () => PAGE_SIZE_OPTS
      },
      current: {
        required: false,
        type: Number
      }
    },
    computed: {
      // 分页条什么时候是多余的？—— **用能选到的最小档都装得下**的时候
      // （首页公告常年只有一条，下面却挂着一排页码）。
      // ⚠️ 判据要用"最小档"而不是"当前档"：带「每页条数」选择器的页面，
      //    选择器就长在这一条上 —— 若按当前档判断，用户把它调到 100 条/页后
      //    条数变成一页、整条消失，就**再也没法调回 30** 了（单程票）。
      //    用最小档判断，只有"任何档位都只有一页"时才隐藏，不会把人困住。
      // 🔥 隐藏必须用模板上的 v-show，**不能用 v-if**：v-if 为假时组件根节点变成
      //    一个**注释节点**，而 Announcements.vue 把它放在 `<transition-group>` 里 ——
      //    Vue 2.5 的 transition-group 更新时会拿这个节点去调 getBoundingClientRect()
      //    /cloneNode()，对注释节点直接抛 TypeError，**导致公告列表的 DOM 更新整个中断、
      //    页面永远停在"无公告"**（2026-10-01 线上真实事故）。v-show 只改 display，
      //    根节点始终是那个 <div>。全站 <transition-group> 只有 Announcements 一处。
      smallestPageSize () {
        if (this.showSizer && this.pageSizeOpts && this.pageSizeOpts.length) {
          return Math.min.apply(null, this.pageSizeOpts)
        }
        // 选择器关着时，实际生效的档位就是 pageSize（缺省按 iView 的默认档 10 算）
        return this.pageSize || DEFAULT_PAGE_SIZE
      },
      showBar () {
        return this.total > this.smallestPageSize
      }
    },
    methods: {
      onChange (page) {
        if (page < 1) {
          page = 1
        }
        this.$emit('update:current', page)
        this.$emit('on-change', page)
      },
      onPageSizeChange (pageSize) {
        this.$emit('update:pageSize', pageSize)
        this.$emit('on-page-size-change', pageSize)
      }
    }
  }
</script>

<style scoped lang="less">
  .page {
    margin: 20px;
    float: right;
    // 🔥 /problem 的根容器是 `display:flex; flex-direction:column` ——
    //    **float 对 flex 子项无效**，于是这条分页在题目页变成整行左对齐，
    //    跟其它页面的右对齐不一致。align-self 只作用于 flex 子项，
    //    在块级父容器下被忽略（那时仍由上面的 float 负责靠右），两边都不打架。
    align-self: flex-end;
  }
</style>

<style lang="less">
  .ivu-page-options-sizer {
    min-width: 85px;
  }
</style>
