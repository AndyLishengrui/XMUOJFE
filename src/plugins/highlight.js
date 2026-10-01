//import hljs from 'highlight.js/lib/highlight'
import cpp from 'highlight.js/lib/languages/cpp'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
// ⚠️ 这里**不能**再 import highlight.js 自带的那套主题 CSS ——
//    'highlight.js/styles/atom-one-light.css' 是写死颜色的亮色主题，
//    暗色下代码块会永远是白底（老师报的"下面的代码背景还是白色"）。
//    配色已改成读主题 token，见 src/styles/hljs.less（在 index.less 里被引入）。
import hljs from "./highlightjs-line-numbers2.js"

hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('java', java)
hljs.registerLanguage('python', python)

export default {
  install (Vue, options) {
    Vue.directive('highlight', {
      deep: true,
      bind: function (el, binding) {
        // init highlightjs-line-numbers
        hljs.initLineNumbersOnLoad();
        // on first bind, highlight all targets
        Array.from(el.querySelectorAll('code')).forEach((target) => {
          // if a value is directly assigned to the directive, use this
          // instead of the element content.
          if (binding.value) {
            target.textContent = binding.value
          }
          hljs.highlightBlock(target)
        })
        // add line numbers
        hljs.initLineNumbersOnLoad({singleLine: true})
      },
      componentUpdated: function (el, binding) {
        // init highlightjs-line-numbers
        hljs.initLineNumbersOnLoad();
        // after an update, re-fill the content and then highlight
        Array.from(el.querySelectorAll('code')).forEach((target) => {
          if (binding.value) {
            target.textContent = binding.value
          }
          hljs.highlightBlock(target)
        })
        // add line numbers
        hljs.initLineNumbersOnLoad({singleLine: true})
      }
    })
  }
}
