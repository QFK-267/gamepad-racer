#!/usr/bin/env bash
# 用默认浏览器打开游戏；如果打不开就起一个本地小服务器再打开。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="file://$DIR/index.html"

echo "游戏文件: $URL"
echo "提示：想用手柄的话，插上手柄后按一下手柄上的任意键，浏览器才会识别它。"

if command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1; then
  exit 0
fi

echo "xdg-open 不可用，改用本地服务器 http://127.0.0.1:8099/"
cd "$DIR"
python3 -m http.server 8099
