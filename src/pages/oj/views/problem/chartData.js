import i18n from '@/i18n'

// 🔑 ECharts 画在 canvas 上，**读不到 CSS 变量**，必须用 getComputedStyle 取真实色值。
// 这样饼图颜色才能跟着主题走 —— 否则暗色主题下这块会是最扎眼的"亮色残留"。
// 取不到时回退到 light 主题的原值，保证任何情况下都有颜色可用。
function themeColor (name, fallback) {
  if (typeof window === 'undefined' || !window.getComputedStyle || !document.documentElement) {
    return fallback
  }
  const v = window.getComputedStyle(document.documentElement).getPropertyValue(name)
  return (v && v.trim()) || fallback
}

function getItemColor (obj) {
  var pieColorMap = new Map()
  pieColorMap.set(i18n.t('m.Short_Accepted'), themeColor('--c-success', '#19be6b'))
  pieColorMap.set(i18n.t('m.Short_Wrong_Answer'), themeColor('--c-error', '#ed3f14'))
  pieColorMap.set(i18n.t('m.Short_Time_Limit_Exceeded'), themeColor('--c-text-3', '#80848f'))
  pieColorMap.set(i18n.t('m.Short_Memory_Limit_Exceeded'), themeColor('--c-st-mle', '#f7de00'))
  pieColorMap.set(i18n.t('m.Short_Runtime_Error'), themeColor('--c-st-re', '#ff6104'))
  pieColorMap.set(i18n.t('m.Short_Compile_Error'), themeColor('--c-st-ce', '#ff9300'))
  pieColorMap.set(i18n.t('m.Short_Partial_Accepted'), themeColor('--c-brand', '#2d8cf0'))
  return pieColorMap.get(obj.name)
}

const pie = {
  legend: {
    left: 'center',
    top: '10',
    orient: 'horizontal',
    data: [i18n.t('m.Short_Accepted'), i18n.t('m.Short_Wrong_Answer')]
  },
  series: [
    {
      name: 'Summary',
      type: 'pie',
      radius: '80%',
      center: ['50%', '55%'],
      itemStyle: {
        normal: {color: getItemColor}
      },
      data: [
        {value: 0, name: i18n.t('m.Short_Wrong_Answer')},
        {value: 0, name: i18n.t('m.Short_Accepted')}
      ],
      label: {
        normal: {
          position: 'inner',
          show: true,
          formatter: '{b}: {c}\n {d}%',
          textStyle: {
            fontWeight: 'bold'
          }
        }
      }
    }
  ]
}

const largePie = {
  legend: {
    left: 'center',
    top:
      '10',
    orient:
      'horizontal',
    itemGap:
      20,
    data:
      [i18n.t('m.Short_Accepted'), i18n.t('m.Short_Runtime_Error'), i18n.t('m.Short_Wrong_Answer'), i18n.t('m.Short_Time_Limit_Exceeded'), i18n.t('m.Short_Partial_Accepted'), i18n.t('m.Short_Memory_Limit_Exceeded')]
  },
  series: [
    {
      name: 'Detail',
      type: 'pie',
      radius: ['45%', '70%'],
      center: ['50%', '55%'],
      itemStyle: {
        normal: {color: getItemColor}
      },
      data: [
        {value: 0, name: i18n.t('m.Short_Runtime_Error')},
        {value: 0, name: i18n.t('m.Short_Wrong_Answer')},
        {value: 0, name: i18n.t('m.Short_Time_Limit_Exceeded')},
        {value: 0, name: i18n.t('m.Short_Accepted')},
        {value: 0, name: i18n.t('m.Short_Memory_Limit_Exceeded')},
        {value: 0, name: i18n.t('m.Short_Partial_Accepted')}
      ],
      label: {
        normal: {
          formatter: '{b}: {c}\n {d}%'
        }
      },
      labelLine: {
        normal: {}
      }
    },
    {
      name: 'Summary',
      type: 'pie',
      radius: '30%',
      center: ['50%', '55%'],
      itemStyle: {
        normal: {color: getItemColor}
      },
      data: [
        {value: 0, name: i18n.t('m.Short_Wrong_Answer')},
        {value: 0, name: i18n.t('m.Short_Accepted'), selected: true}
      ],
      label: {
        normal: {
          position: 'inner',
          formatter: '{b}: {c}\n {d}%'
        }
      }
    }
  ]
}

export { pie, largePie }
