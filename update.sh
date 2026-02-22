#!/usr/bin/env bash
# docs/workspace 내 파일을 프로젝트 루트로 복사합니다. 대상에 있는 같은 경로는 먼저 지운 뒤 덮어씁니다.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../chaejinims2.github.io" && pwd)"

echo "소스: $SCRIPT_DIR"
echo "대상: $PROJECT_ROOT"

# workspace에 있는 항목에 대응하는 루트 쪽 기존 파일/폴더를 먼저 삭제
for name in "$SCRIPT_DIR"/*; do
  [ -e "$name" ] || continue
  base="$(basename "$name")"
  [ "$base" = "update.sh" ] && continue
  [ "$base" = "old" ] && continue
  [ "$base" = "assets" ] && continue
  [ "$base" = "_data" ] && continue
  [ "$base" = "README.md" ] && continue
  dest="$PROJECT_ROOT/$base"
  if [ -e "$dest" ]; then
    echo "삭제: $dest"
    rm -rf "$dest"
  fi
done

echo "복사 중..."
rsync -av --exclude='update.sh' --exclude='old' "$SCRIPT_DIR/" "$PROJECT_ROOT/"

# _pages: index.md가 아닌 .md 파일은 해당 이름 폴더/index.md 로 변환
PAGES_ROOT="$PROJECT_ROOT/_pages"
if [ -d "$PAGES_ROOT" ]; then
  while IFS= read -r -d '' f; do
    dir="$(dirname "$f")"
    base="$(basename "$f" .md)"
    target_dir="$dir/$base"
    mkdir -p "$target_dir"
    cat "$f" > "$target_dir/index.md"
    rm -f "$f"
    echo "  → $target_dir/index.md"
  done < <(find "$PAGES_ROOT" -type f -name "*.md" ! -name "index.md" -print0 2>/dev/null)
fi

echo "완료."
