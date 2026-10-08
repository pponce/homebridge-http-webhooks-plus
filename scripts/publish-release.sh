#!/usr/bin/env bash
# Publish the checked-out, tested package. Never changes a Homebridge installation.
set -euo pipefail
cd "$(dirname "$0")/.."
task_registry='https://registry.npmjs.org/'
task_expected_commit="${1:?Usage: bash scripts/publish-release.sh EXPECTED_COMMIT}"
[[ "$(git rev-parse HEAD)" = "$task_expected_commit" ]] || { echo 'Unexpected source commit; stopped.'; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Source checkout has local changes; stopped.'; exit 1; }
task_version=$(node -p 'require("./package.json").version')
task_name=$(node -p 'require("./package.json").name')
task_tmp=$(mktemp -d)
trap 'rm -rf -- "$task_tmp"' EXIT

npm install --include=dev --ignore-scripts --no-package-lock --no-audit --no-fund
npm test
npm run test:hap
npm run test:ui-server
npx playwright install chromium
npm run test:ui
node -e 'if (typeof require("./index.js") !== "function") process.exit(1)'
[[ -z "$(git status --porcelain)" ]] || { echo 'Checks changed source files; stopped.'; exit 1; }
npm pack --json --pack-destination "$task_tmp" > "$task_tmp/pack.json"
task_tarball="$task_tmp/$(node -p 'require(process.argv[1])[0].filename' "$task_tmp/pack.json")"
task_integrity=$(node -p 'require(process.argv[1])[0].integrity' "$task_tmp/pack.json")
tar -tzf "$task_tarball" > "$task_tmp/package-files.txt"
node - "$task_tmp/package-files.txt" <<'NODE'
const fs = require('fs');
const files = new Set(fs.readFileSync(process.argv[2], 'utf8').trim().split('\n'));
for (const file of ['index.js', 'package.json', 'config.schema.json', 'LICENSE',
  'homebridge-ui/public/index.html', 'homebridge-ui/public/index.js',
  'homebridge-ui/public/model.js', 'homebridge-ui/public/api.js',
  'homebridge-ui/public/actions.js', 'src/ActionApi.js',
  'homebridge-ui/server.js', 'homebridge-ui/requests.js',
  'homebridge-ui/public/styles.css', 'docs/STATE_API.md']) {
  if (!files.has('package/' + file)) throw Error('Missing package file: ' + file);
}
for (const file of files) {
  if (/^package\/(?:test|scripts|node_modules|\.git)\//.test(file)) throw Error('Unexpected package file: ' + file);
}
console.log('Tarball inspected: runtime, API reference, UI assets and license present.');
NODE
echo "Prepared $task_name@$task_version from $task_expected_commit"
echo "Package integrity: $task_integrity"

# A lookup/authentication error must not be mistaken for an unpublished version.
if npm view "$task_name@$task_version" dist.integrity --json --prefer-online --registry="$task_registry" > "$task_tmp/registry.json" 2> "$task_tmp/registry-error.txt"; then
  task_existing=$(node -p 'require(process.argv[1])' "$task_tmp/registry.json")
  [[ "$task_existing" = "$task_integrity" ]] || { echo 'This version already exists with different contents; stopped.'; exit 1; }
  echo 'The exact package is already published and verified.'
  exit 0
fi
node -e 'const fs=require("fs");let r;try{r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{};if(r?.error?.code!=="E404")process.exit(1)' "$task_tmp/registry.json" || {
  cat "$task_tmp/registry-error.txt"; echo 'Registry lookup failed; publication stopped.'; exit 1;
}

echo 'Complete any npm authentication link in your browser, leaving this terminal open.'
npm whoami --registry="$task_registry" || npm login --browser=false --registry="$task_registry"
npm publish "$task_tarball" --access public --browser=false --registry="$task_registry"
echo 'Waiting up to 10 minutes for npm registry confirmation.'
task_confirmation_deadline=$((SECONDS + 600))
while ((SECONDS < task_confirmation_deadline)); do
  task_remaining=$((task_confirmation_deadline - SECONDS))
  ((task_remaining > 0)) || break
  task_fetch_timeout_ms=$((task_remaining < 10 ? task_remaining * 1000 : 10000))
  task_actual=$(npm view "$task_name@$task_version" dist.integrity --prefer-online --fetch-retries=0 --fetch-timeout="$task_fetch_timeout_ms" --registry="$task_registry" 2>/dev/null) || task_actual=''
  if [[ "$task_actual" = "$task_integrity" ]]; then
    echo "Published and verified: $task_name@$task_version"
    exit 0
  fi
  if [[ -n "$task_actual" ]]; then echo 'Registry artifact differs; stopped for review.'; exit 1; fi
  task_remaining=$((task_confirmation_deadline - SECONDS))
  ((task_remaining > 0)) || break
  echo "Waiting for npm registry confirmation; up to $task_remaining seconds remaining."
  sleep "$((task_remaining < 10 ? task_remaining : 10))"
done
echo 'npm accepted publication, but registry verification is still pending after 10 minutes. Rerun this script to verify before installing.'
exit 1
