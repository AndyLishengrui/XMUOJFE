'use strict'
const path = require('path')
const config = require('../config')
const ExtractTextPlugin = require('extract-text-webpack-plugin')
// 主题变量：注入到每一次 LESS 编译（iView 的源 + 各 .vue 的 <style lang="less">）
const { THEME, vars: themeVars } = require('./themes')

exports.assetsPath = function (_path) {
  const assetsSubDirectory = process.env.NODE_ENV === 'production'
    ? config.build.assetsSubDirectory
    : config.dev.assetsSubDirectory
  return path.posix.join(assetsSubDirectory, _path)
}

exports.cssLoaders = function (options) {
  options = options || {}

  const cssLoader = {
    loader: 'css-loader',
    options: {
      minimize: process.env.NODE_ENV === 'production',
      sourceMap: options.sourceMap
    }
  }

  // generate loader string to be used with extract text plugin
  function generateLoaders (loader, loaderOptions) {
    const loaders = [cssLoader]
    if (loader) {
      const opts = Object.assign({}, loaderOptions, {
        sourceMap: options.sourceMap
      })
      // 🔑 主题注入点：modifyVars 在 LESS 编译末尾生效，会**覆盖** iView
      // custom.less 里的默认值，从而把整套 iView 组件换成主题配色。
      if (loader === 'less') {
        opts.modifyVars = Object.assign({}, themeVars, opts.modifyVars || {})
      }
      loaders.push({
        loader: loader + '-loader',
        options: opts
      })
    }

    // Extract CSS when that option is specified
    // (which is the case during production build)
    if (options.extract) {
      return ExtractTextPlugin.extract({
        use: loaders,
        fallback: 'vue-style-loader'
      })
    } else {
      return ['vue-style-loader'].concat(loaders)
    }
  }

  // https://vue-loader.vuejs.org/en/configurations/extract-css.html
  return {
    css: generateLoaders(),
    postcss: generateLoaders(),
    less: generateLoaders('less'),
    sass: generateLoaders('sass', {indentedSyntax: true}),
    scss: generateLoaders('sass'),
    stylus: generateLoaders('stylus'),
    styl: generateLoaders('stylus')
  }
}

// Generate loaders for standalone style files (outside of .vue)
exports.styleLoaders = function (options) {
  const output = []
  const loaders = exports.cssLoaders(options)
  for (const extension in loaders) {
    const loader = loaders[extension]
    output.push({
      test: new RegExp('\\.' + extension + '$'),
      use: loader
    })
  }
  return output
}

exports.getNodeEnv = function () {
  const NODE_ENV = process.env.NODE_ENV
  return NODE_ENV ? NODE_ENV: 'production'
}
