import 'babel-polyfill'
import Vue from 'vue'
import App from './App.vue'
import router from './router'
import store from '@/store'
import i18n from '@/i18n'
import VueClipboard from 'vue-clipboard2'
import VueAnalytics from 'vue-analytics'
import { GOOGLE_ANALYTICS_ID } from '@/utils/constants'

import iView from 'iview'
// 🔑 主题化：改为引入 iView 的 **LESS 源**（原来是预编译的 iview.css）。
// 只有用 LESS 源，less-loader 的 modifyVars 才能覆盖 iView 的默认配色
// —— 预编译 CSS 里的颜色是写死的，运行时/构建期都改不动。
// 主题变量的具体值见 build/themes/*.js（由 build/utils.js 注入）。
import 'iview/src/styles/index.less'

import Panel from '@oj/components/Panel.vue'
import VerticalMenu from '@oj/components/verticalMenu/verticalMenu.vue'
import VerticalMenuItem from '@oj/components/verticalMenu/verticalMenu-item.vue'
import '@/styles/index.less'

import highlight from '@/plugins/highlight'
import katex from '@/plugins/katex'
import filters from '@/utils/filters.js'

// ⚠️ ECharts（echarts + zrender 约 1.1MB）**不在入口引** —— 见下面注册成异步组件那一行。
//    图表类型与组件都收在 src/plugins/echarts.js，只有排行榜类页面会用到。

// register global utility filters.
Object.keys(filters).forEach(key => {
  Vue.filter(key, filters[key])
})

Vue.config.productionTip = false
Vue.use(iView, {
  i18n: (key, value) => i18n.t(key, value)
})

Vue.use(VueClipboard)
Vue.use(highlight)
Vue.use(katex)
Vue.use(VueAnalytics, {
  id: GOOGLE_ANALYTICS_ID,
  router
})

// 🔥 异步组件：ECharts 不在首包里，只有模板里真的渲染 <ECharts> 时才去下那个 chunk。
//    用法完全不变（模板照旧写 <ECharts>），但**首次渲染会晚一拍** ⇒
//    凡是用 this.$refs.chart 的地方都得判空（contestRankMixin / ACMRank / OIRank 已处理）。
Vue.component('ECharts', () => import(/* webpackChunkName: "echarts" */ '@/plugins/echarts'))
Vue.component(VerticalMenu.name, VerticalMenu)
Vue.component(VerticalMenuItem.name, VerticalMenuItem)
Vue.component(Panel.name, Panel)

// 注册全局消息提示
Vue.prototype.$Message.config({
  duration: 2
})
Vue.prototype.$error = (s) => Vue.prototype.$Message.error(s)
Vue.prototype.$info = (s) => Vue.prototype.$Message.info(s)
Vue.prototype.$success = (s) => Vue.prototype.$Message.success(s)

new Vue(Vue.util.extend({router, store, i18n}, App)).$mount('#app')
