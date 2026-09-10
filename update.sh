#!/bin/sh
# tikhub とゲームを最新版に更新します (macOS / Linux)。
# Windows の方は update.cmd をダブルクリックしてください。
#
# npm run update と中身は同じですが、npm を経由しません。
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。https://nodejs.org/ja から LTS 版を入れてください。"
  exit 1
fi

node tools/update.js "$@"
