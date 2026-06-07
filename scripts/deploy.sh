#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S3_BUCKET="${S3_BUCKET:-}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
SITE_URL="${SITE_URL:-}"
DEPLOY_NAMES_FILE="${DEPLOY_NAMES_FILE:-deploy-names.txt}"
DEPLOY_INFO_FILE="deploy.json"

cd "$ROOT_DIR"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required. Install and configure it before deploying." >&2
  exit 1
fi

if [[ -z "$S3_BUCKET" ]]; then
  echo "S3_BUCKET is required." >&2
  exit 1
fi

if [[ -z "$CLOUDFRONT_DISTRIBUTION_ID" ]]; then
  echo "CLOUDFRONT_DISTRIBUTION_ID is required." >&2
  exit 1
fi

if [[ ! -f "$DEPLOY_NAMES_FILE" ]]; then
  echo "${DEPLOY_NAMES_FILE} is required." >&2
  exit 1
fi

mapfile -t DEPLOY_NAMES < "$DEPLOY_NAMES_FILE"
if [[ "${#DEPLOY_NAMES[@]}" -eq 0 ]]; then
  echo "${DEPLOY_NAMES_FILE} must contain at least one deploy name." >&2
  exit 1
fi

DEPLOY_NAME="${DEPLOY_NAMES[$((RANDOM % ${#DEPLOY_NAMES[@]}))]}"
printf '{"name":"%s","deployedAt":"%s"}\n' "$DEPLOY_NAME" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$DEPLOY_INFO_FILE"

echo "Deploy name: ${DEPLOY_NAME}"
echo "Uploading game files to s3://${S3_BUCKET}..."
aws s3 cp index.html "s3://${S3_BUCKET}/index.html" \
  --content-type "text/html; charset=utf-8" \
  --cache-control "no-cache"
aws s3 cp styles.css "s3://${S3_BUCKET}/styles.css" \
  --content-type "text/css; charset=utf-8" \
  --cache-control "public,max-age=300"
aws s3 cp app.js "s3://${S3_BUCKET}/app.js" \
  --content-type "application/javascript; charset=utf-8" \
  --cache-control "public,max-age=300"
aws s3 cp "$DEPLOY_INFO_FILE" "s3://${S3_BUCKET}/${DEPLOY_INFO_FILE}" \
  --content-type "application/json; charset=utf-8" \
  --cache-control "no-cache"

echo "Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*" \
  --query "Invalidation.Id" \
  --output text

if [[ -n "$SITE_URL" ]]; then
  echo "Deploy complete: ${SITE_URL}"
else
  echo "Deploy complete."
fi
