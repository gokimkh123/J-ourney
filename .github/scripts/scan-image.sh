#!/usr/bin/env bash
# 컨테이너 이미지 비밀값 검사: .env 계열 파일이나 앱 코드 속 키 형태 문자열이 있으면 실패함
# 사용법: bash .github/scripts/scan-image.sh <이미지 이름>
set -euo pipefail
image="$1"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# 1. 이미지 전체에서 .env 계열 파일 찾기 (.env.example 제외)
envs="$(docker run --rm --user root --entrypoint sh "$image" -c "find / -xdev \( -name '.env' -o -name '.env.*' \) ! -name '.env.example' 2>/dev/null" || true)"
if [ -n "$envs" ]; then
  echo "차단: 이미지에 .env 계열 파일이 있음"
  echo "$envs"
  exit 1
fi

# 2. 앱 코드·설정(node_modules 제외)을 꺼내 gitleaks로 검사
cid="$(docker create "$image")"
docker cp -q "$cid:/app/dist" "$work/dist"
docker cp -q "$cid:/app/package.json" "$work/"
docker cp -q "$cid:/app/package-lock.json" "$work/"
docker cp -q "$cid:/app/drizzle" "$work/drizzle"
docker cp -q "$cid:/app/dev-ui" "$work/dev-ui"
docker rm "$cid" > /dev/null
docker run --rm -v "$work:/scan:ro" -v "$PWD/.gitleaks.toml:/cfg.toml:ro" \
  ghcr.io/gitleaks/gitleaks:v8.30.1 dir /scan --config /cfg.toml --redact --no-banner
echo "이미지 비밀값 검사 통과: $image"
