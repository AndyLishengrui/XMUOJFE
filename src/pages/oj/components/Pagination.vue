<template>
  <div class="page">
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
      // 每页条数可选项 —— 提成 prop，这样各页可以按自己的数据密度定制
      // （比如题目列表行矮、信息密，就不需要 10 条这种稀疏档）
      pageSizeOpts: {
        required: false,
        type: Array,
        default: () => [10, 30, 50, 100, 200]
      },
      current: {
        required: false,
        type: Number
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
  }
</style>

<style lang="less">
  .ivu-page-options-sizer {
    min-width: 85px;
  }
</style>
