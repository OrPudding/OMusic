#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
THEMES_DIR="$ROOT_DIR/themes"
DIST_DIR="$ROOT_DIR/dist"
OUT_DIR="$ROOT_DIR/theme_builds"

FUZZ="${FUZZ:-20}"

SUCCESS_COUNT=0
FAIL_COUNT=0
SUMMARY_LINES=()

cd "$ROOT_DIR" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "错误：未找到 python3"
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "错误：未找到 pnpm"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "错误：未找到 git"
  exit 1
fi

if [ ! -f "$ROOT_DIR/color_replace.py" ]; then
  echo "错误：未找到 color_replace.py"
  exit 1
fi

if [ ! -d "$THEMES_DIR" ]; then
  echo "错误：未找到 themes 目录"
  exit 1
fi

mkdir -p "$OUT_DIR"

restore_repo() {
  echo ">> 恢复仓库状态到 HEAD..."
  git reset --hard HEAD >/dev/null 2>&1
  git clean -fd -e "$(basename "$OUT_DIR")/" >/dev/null 2>&1
}

cleanup_on_exit() {
  restore_repo
}
trap cleanup_on_exit EXIT

find_latest_rpk() {
  find "$DIST_DIR" -maxdepth 1 -type f -name "*.rpk" -print0 2>/dev/null \
    | xargs -0 ls -1t 2>/dev/null \
    | head -n 1
}

echo "===================================="
echo "开始批量构建 Monet 主题"
echo "项目目录: $ROOT_DIR"
echo "主题目录: $THEMES_DIR"
echo "输出目录: $OUT_DIR"
echo "fuzz 参数: $FUZZ"
echo "当前基线提交: $(git rev-parse --short HEAD)"
echo "===================================="
echo

mapfiles=("$THEMES_DIR"/*.map)

if [ ! -e "${mapfiles[0]}" ]; then
  echo "错误：themes 目录下没有 .map 文件"
  exit 1
fi

for map_path in "${mapfiles[@]}"; do
  map_file="$(basename "$map_path")"
  theme_name="${map_file%.map}"
  color_name="${theme_name#monet_}"

  echo "------------------------------------"
  echo "处理主题: $theme_name"
  echo "映射文件: $map_file"
  echo "颜色名:   $color_name"
  echo "------------------------------------"

  restore_repo

  if ! python3 color_replace.py "$map_path" --fuzz "$FUZZ"; then
    echo "❌ 替换失败: $theme_name"
    SUMMARY_LINES+=("❌ $theme_name | 替换失败")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo
    continue
  fi

  if ! pnpm release; then
    echo "❌ 构建失败: $theme_name"
    SUMMARY_LINES+=("❌ $theme_name | pnpm release 失败")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo
    continue
  fi

  rpk_path="$(find_latest_rpk)"

  if [ -z "${rpk_path:-}" ] || [ ! -f "$rpk_path" ]; then
    echo "❌ 未找到构建产物: $theme_name"
    SUMMARY_LINES+=("❌ $theme_name | 未找到 dist/*.rpk")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo
    continue
  fi

  rpk_name="$(basename "$rpk_path")"
  new_name="${color_name}_${rpk_name}"
  target_path="$OUT_DIR/$new_name"

  if cp -f "$rpk_path" "$target_path"; then
    file_size="$(du -h "$target_path" | awk '{print $1}')"
    echo "✅ 构建成功: $theme_name"
    echo "   产物: $target_path"
    SUMMARY_LINES+=("✅ $theme_name | $new_name | $file_size")
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    echo "❌ 复制失败: $theme_name"
    SUMMARY_LINES+=("❌ $theme_name | 复制产物失败")
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  echo
done

restore_repo

echo
echo "===================================="
echo "构建完成"
echo "成功: $SUCCESS_COUNT"
echo "失败: $FAIL_COUNT"
echo "输出目录: $OUT_DIR"
echo "===================================="

for line in "${SUMMARY_LINES[@]}"; do
  echo "$line"
done