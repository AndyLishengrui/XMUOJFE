const webpack = require('webpack');
const path = require('path');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin')
const config = require('../config')
const utils = require('./utils')
const glob = require('glob')
const fs = require('fs')

function resolve (dir) {
  return path.join(__dirname, '..', dir)
}

const NODE_ENV = utils.getNodeEnv()

const vendors = [
  'vue/dist/vue.esm.js',
  'vue-router',
  'vuex',
  'axios',
  'moment',
  // ⚠️ 2026-10-02 去掉 'raven-js'：前端只在 USE_SENTRY=1 时才引 src/utils/sentry.js，
  //    生产从不开这个开关（config/dev.env.js 里也是 '0'）⇒ 整个 raven 是**死重量**，
  //    却因为列在这里被塞进 dll，每个访问者都白下。
  //    真要重开 Sentry，记得连这一行一起加回来。
  'browser-detect'
];

// clear old dll
const globOptions = {cwd: resolve('static/js'), absolute: true};
let oldDlls = glob.sync('vendor.dll.*.js', globOptions);
console.log("cleaning old dll..")
oldDlls.forEach(f => {
  fs.unlink(f, _ => {})
})
console.log("building ..")

module.exports = {
  entry: {
    "vendor": vendors,
  },
  output: {
    path: path.join(__dirname, '../static/js'),
    filename: '[name].dll.[hash:7].js',
    library: '[name]_[hash]_dll',
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': NODE_ENV === 'production' ? config.build.env : config.dev.env
    }),
    new webpack.optimize.ModuleConcatenationPlugin(),
    new webpack.ContextReplacementPlugin(/moment[\/\\]locale$/, /zh-cn/),
    new UglifyJSPlugin({
      exclude: /\.min\.js$/,
      cache: true,
      parallel: true
    }),
    new webpack.DllPlugin({
      context: __dirname,
      path: path.join(__dirname, '[name]-manifest.json'),
      name: '[name]_[hash]_dll',
    })
  ]
};
