#!/bin/bash
#
# 构建三套主题、收集三份 CSS、生成 theme-map.json，最后产出待部署的 dist/。
#
#   cd /OnlineJudgeFE && npm run build:themes
#
# 为什么要一次把三套都建出来：
#   三份 CSS 的 `data-v-*` 作用域哈希由**组件文件内容**算出 —— 源码一改，三个哈希**全变**。
#   只换其中一两份 → 主题 CSS 与线上 JS 的作用域对不上 → 样式整片失效。
#   所以三份必须**同批产出、同批部署**。
#
# 产物：
#   ~/theme_builds/<主题>/oj.<hash>.css   ← 待部署的三份（文件名保持内容哈希）
#   build/themes/theme-map.json           ← 「主题名 → 文件名」映射，被 patch-theme-index.js 读
#   dist/                                 ← THEME=light 的完整产物（index.html 已打补丁）
#
set -e
cd "$(dirname "$0")/.."          # → /OnlineJudgeFE
export PATH=/usr/local/node16/bin:$PATH

OUT=dist/static/css
DEST=$HOME/theme_builds
MAP=build/themes/theme-map.json

# webpack 3 打完包**不会自己退出** —— 每建一次就留一个常驻 node，
# 攒起来会把机器拖垮（本项目踩过：32 个进程跑了 7 天）。每轮结束都清一次。
# ⚠️ pkill 的 pattern 必须写成 [n]ode，否则会匹配到自己的 shell。
build_one () {
  local T=$1
  rm -f "/tmp/ct_$T.log"
  THEME=$T node build/build.js > "/tmp/ct_$T.log" 2>&1 &
  local i
  for i in $(seq 1 90); do
    # 用 if 而不是 `grep && break`：后者在 set -e 下行为不直观
    if grep -q "built complete" "/tmp/ct_$T.log" 2>/dev/null; then break; fi
    sleep 5
  done
  sleep 3
  pkill -f "[n]ode build/build.js" 2>/dev/null || true
  kill -9 $(pgrep -f "[n]ode build/build.js") 2>/dev/null || true

  grep -q "built complete" "/tmp/ct_$T.log" || { echo "❌ $T 构建失败"; tail -5 "/tmp/ct_$T.log"; exit 1; }
}

declare_map=""
for T in light deep sand; do
  echo "=== 构建 $T ==="
  build_one "$T"
  CSS=$(basename "$(ls -t $OUT/oj.*.css | head -1)")
  mkdir -p "$DEST/$T"
  rm -f "$DEST/$T"/oj.*.css
  cp "$OUT/$CSS" "$DEST/$T/"
  echo "    → $CSS"
  declare_map="$declare_map\"$T\":\"$CSS\","
done
declare_map="{${declare_map%,}}"

echo "=== 写 $MAP ==="
printf '%s\n' "$declare_map" > "$MAP"
cat "$MAP"

echo "=== 重新构建 light 作为待部署产物 ==="
build_one light
node build/patch-theme-index.js

echo
echo "✅ 完成。待部署文件："
for T in light deep sand; do
  echo "   $DEST/$T/$(ls "$DEST/$T")"
done
echo "   dist/index.html（已打补丁）"
