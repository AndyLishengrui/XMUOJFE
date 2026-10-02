// ECharts 单独收拢成一个模块，供**异步组件**加载。
//
// 为什么要拆（2026-10-02 量过）：echarts + zrender 一共约 **1.1 MB**（未压缩），
// 原来写在 src/pages/oj/index.js 的**入口**里 ⇒ 每个访问者、每个页面都要先下完它
// 才能开始渲染。但它其实**只有排行榜 / 统计那几个页面用得到**。
// 拆出去之后 webpack 会把它打成独立 chunk，只有真的渲染 <ECharts> 时才下载。
//
// ⚠️ 只引需要的图表类型和组件 —— 全量 `import echarts from 'echarts'` 会更大。
//    要加新的图表类型，加在这里（不是加到入口）。
import ECharts from 'vue-echarts/components/ECharts.vue'
import 'echarts/lib/chart/bar'
import 'echarts/lib/chart/line'
import 'echarts/lib/chart/pie'
import 'echarts/lib/component/title'
import 'echarts/lib/component/grid'
import 'echarts/lib/component/dataZoom'
import 'echarts/lib/component/legend'
import 'echarts/lib/component/tooltip'
import 'echarts/lib/component/toolbox'
import 'echarts/lib/component/markPoint'

export default ECharts
