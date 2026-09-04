#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly SERVICE='identityprism-proxy.service'
readonly APP_DIR='/opt/identityprism/helius-proxy'
readonly BACKUP_DIR='/opt/identityprism/deploy-backups/7b13f0d'
readonly CANDIDATE_DIR='/tmp/identityprism-api-7b13f0d/server'
readonly LOCK_FILE='/run/lock/identityprism-api-7b13f0d.lock'
readonly RESULT_FILE='/opt/identityprism/deploy-backups/7b13f0d/ACTIVATE.result'

readonly APP_ROUTE='/opt/identityprism/helius-proxy/routes/reputation.js'
readonly APP_BUILDER='/opt/identityprism/helius-proxy/services/reputationBuilder.js'
readonly APP_CONTRACT='/opt/identityprism/helius-proxy/services/reputationContract.js'
readonly BACKUP_ROUTE='/opt/identityprism/deploy-backups/7b13f0d/routes/reputation.js'
readonly BACKUP_BUILDER='/opt/identityprism/deploy-backups/7b13f0d/services/reputationBuilder.js'
readonly CANDIDATE_ROUTE='/tmp/identityprism-api-7b13f0d/server/routes/reputation.js'
readonly CANDIDATE_BUILDER='/tmp/identityprism-api-7b13f0d/server/services/reputationBuilder.js'
readonly CANDIDATE_CONTRACT='/tmp/identityprism-api-7b13f0d/server/services/reputationContract.js'

readonly ROUTE_SHA256='62a9aadab6996f26f23447f506ec9c482b36c214d3983aee54196dc910c36ec2'
readonly BUILDER_SHA256='d063f6019ac55ffa56da080ebf74dc9d2f627294e94b72e4eacabd1f818656ef'
readonly CONTRACT_SHA256='0a0e508f6a51a69c6a9ed208d46dad0bd6be2d62417654adaedd6afda3966d96'
readonly OLD_ROUTE_SHA256='94057437ee6d534911f61ff555da314ec2b8dadcf26ccc71fde3150be79c3465'
readonly OLD_BUILDER_SHA256='12c1e20b590af03cdfbcc90084298e7680a536ade829883a9eac2657e9a9fa68'
readonly TEST_ADDRESS='2psA2ZHmj8miBjfSqQdjimMCSShVuc2v6yUpSLeLr4RN'
readonly BASE_URL='http://127.0.0.1:8787'

if (( EUID != 0 )); then
  exit 77
fi

# nohup protects the process from SSH disconnects; explicitly preserve that
# behavior and keep command diagnostics out of persistent output.
trap '' HUP
exec >/dev/null 2>&1

command -v flock >/dev/null
command -v stat >/dev/null

[[ -d "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]]
[[ "$(stat -c '%u' -- "$BACKUP_DIR")" == '0' ]]

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 75
fi

# A concurrent run owns the marker while it owns the lock. Only the lock holder
# may validate or replace it.
if [[ -e "$RESULT_FILE" || -L "$RESULT_FILE" ]]; then
  [[ -f "$RESULT_FILE" && ! -L "$RESULT_FILE" ]]
  [[ "$(stat -c '%u' -- "$RESULT_FILE")" == '0' ]]
fi

rollback_armed=0

write_marker() {
  local marker="$1"
  case "$marker" in
    RUNNING|PASS|FAIL_PREFLIGHT|FAIL_ROLLED_BACK|FAIL_ROLLBACK_FAILED) ;;
    *) return 1 ;;
  esac
  printf '%s\n' "$marker" >"$RESULT_FILE"
  chmod 0600 "$RESULT_FILE"
}

json_ok() {
  local url="$1"
  local max_time="$2"
  local validator="$3"

  curl --fail --silent --show-error \
    --connect-timeout 5 \
    --max-time "$max_time" \
    --header 'Accept: application/json' \
    -- "$url" \
    | node -e "$validator"
}

readonly HEALTH_VALIDATOR='let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const d=JSON.parse(s);if(!d||typeof d!=="object"||d.ok!==true)process.exitCode=1;}catch{process.exitCode=1;}});'

wait_for_health() {
  local budget_seconds="$1"
  local deadline=$((SECONDS + budget_seconds))

  while (( SECONDS < deadline )); do
    if systemctl is-active --quiet "$SERVICE" \
      && json_ok "$BASE_URL/health" 15 "$HEALTH_VALIDATOR"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

check_with_retries() {
  local url="$1"
  local validator="$2"
  local attempts="$3"
  local max_time="$4"
  local delay_seconds="$5"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if systemctl is-active --quiet "$SERVICE" \
      && json_ok "$url" "$max_time" "$validator"; then
      return 0
    fi
    if (( attempt < attempts )); then
      sleep "$delay_seconds"
    fi
  done
  return 1
}

is_secure_dir() {
  local path="$1"
  local mode

  [[ -d "$path" && ! -L "$path" ]]
  [[ "$(stat -c '%u' -- "$path")" == '0' ]]
  mode="$(stat -c '%a' -- "$path")"
  (( (8#$mode & 0022) == 0 ))
}

is_root_owned_real_dir() {
  local path="$1"

  [[ -d "$path" && ! -L "$path" ]]
  [[ "$(stat -c '%u' -- "$path")" == '0' ]]
}

is_safe_regular_file() {
  local path="$1"
  local mode

  [[ -f "$path" && ! -L "$path" ]]
  mode="$(stat -c '%a' -- "$path")"
  (( (8#$mode & 0022) == 0 ))
}

is_root_owned_regular_file() {
  local path="$1"

  [[ -f "$path" && ! -L "$path" ]]
  [[ "$(stat -c '%u' -- "$path")" == '0' ]]
}

is_secure_root_file() {
  local path="$1"

  is_safe_regular_file "$path"
  [[ "$(stat -c '%u' -- "$path")" == '0' ]]
}

is_absent() {
  local path="$1"
  [[ ! -e "$path" && ! -L "$path" ]]
}

sha256_matches() {
  local path="$1"
  local expected="$2"
  local output

  output="$(sha256sum -- "$path")"
  [[ "${output%% *}" == "$expected" ]]
}

rollback_old() {
  local failed=0

  install -o root -g root -m 0644 -- "$BACKUP_ROUTE" "$APP_ROUTE" || failed=1
  install -o root -g root -m 0644 -- "$BACKUP_BUILDER" "$APP_BUILDER" || failed=1
  rm -f -- "$APP_CONTRACT" || failed=1

  timeout 300s systemctl restart "$SERVICE" || failed=1
  wait_for_health 240 || failed=1
  cmp -s -- "$BACKUP_ROUTE" "$APP_ROUTE" || failed=1
  cmp -s -- "$BACKUP_BUILDER" "$APP_BUILDER" || failed=1
  is_absent "$APP_CONTRACT" || failed=1
  systemctl is-active --quiet "$SERVICE" || failed=1

  (( failed == 0 ))
}

on_exit() {
  local rc=$?
  local rollback_ok=1

  trap - EXIT
  trap '' INT TERM HUP

  if (( rc == 0 )); then
    return 0
  fi

  set +e
  if (( rollback_armed == 1 )); then
    rollback_old
    rollback_ok=$?
    if (( rollback_ok == 0 )); then
      write_marker 'FAIL_ROLLED_BACK' || true
    else
      write_marker 'FAIL_ROLLBACK_FAILED' || true
    fi
  else
    write_marker 'FAIL_PREFLIGHT' || true
  fi
  exit "$rc"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for required_command in chmod cmp curl install node rm sha256sum sleep systemctl timeout; do
  command -v "$required_command" >/dev/null
done

write_marker 'RUNNING'

for required_dir in \
  "$APP_DIR" \
  "$APP_DIR/routes" \
  "$APP_DIR/services"; do
  is_root_owned_real_dir "$required_dir"
done

for required_dir in \
  "$BACKUP_DIR" \
  "$BACKUP_DIR/routes" \
  "$BACKUP_DIR/services" \
  "$CANDIDATE_DIR" \
  "$CANDIDATE_DIR/routes" \
  "$CANDIDATE_DIR/services"; do
  is_secure_dir "$required_dir"
done

for required_file in \
  "$APP_ROUTE" \
  "$APP_BUILDER"; do
  is_root_owned_regular_file "$required_file"
done

for required_file in \
  "$BACKUP_ROUTE" \
  "$BACKUP_BUILDER"; do
  is_secure_root_file "$required_file"
done

for required_file in \
  "$CANDIDATE_ROUTE" \
  "$CANDIDATE_BUILDER" \
  "$CANDIDATE_CONTRACT"; do
  is_secure_root_file "$required_file"
done

is_absent "$APP_CONTRACT"
sha256_matches "$APP_ROUTE" "$OLD_ROUTE_SHA256"
sha256_matches "$APP_BUILDER" "$OLD_BUILDER_SHA256"
sha256_matches "$BACKUP_ROUTE" "$OLD_ROUTE_SHA256"
sha256_matches "$BACKUP_BUILDER" "$OLD_BUILDER_SHA256"
cmp -s -- "$BACKUP_ROUTE" "$APP_ROUTE"
cmp -s -- "$BACKUP_BUILDER" "$APP_BUILDER"
systemctl is-active --quiet "$SERVICE"
wait_for_health 60

sha256_matches "$CANDIDATE_ROUTE" "$ROUTE_SHA256"
sha256_matches "$CANDIDATE_BUILDER" "$BUILDER_SHA256"
sha256_matches "$CANDIDATE_CONTRACT" "$CONTRACT_SHA256"
node --check "$CANDIDATE_ROUTE"
node --check "$CANDIDATE_BUILDER"
node --check "$CANDIDATE_CONTRACT"

rollback_armed=1

install -o root -g root -m 0644 -- "$CANDIDATE_ROUTE" "$APP_ROUTE"
install -o root -g root -m 0644 -- "$CANDIDATE_BUILDER" "$APP_BUILDER"
install -o root -g root -m 0644 -- "$CANDIDATE_CONTRACT" "$APP_CONTRACT"

sha256_matches "$APP_ROUTE" "$ROUTE_SHA256"
sha256_matches "$APP_BUILDER" "$BUILDER_SHA256"
sha256_matches "$APP_CONTRACT" "$CONTRACT_SHA256"

# TimeoutStopUSec is 90 seconds. Give systemd and the subsequent application
# health gate independent windows that are each comfortably above 180 seconds.
timeout 300s systemctl restart "$SERVICE"
wait_for_health 240

readonly LEGACY_VALIDATOR='let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const d=JSON.parse(s),n=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b,i=d&&d.identity,ok=d&&typeof d==="object"&&d.maxScore===400&&n(d.baseScore,0,400)&&typeof d.baseTier==="string"&&d.baseTier.length>0&&d.baseMaxScore===400&&n(d.compositeScore,0,1000)&&typeof d.compositeTier==="string"&&d.compositeTier.length>0&&d.compositeMaxScore===1000&&n(d.score,0,400)&&d.score===d.baseScore&&d.tier===d.baseTier&&i&&typeof i==="object"&&i.score===d.baseScore&&i.maxScore===400&&i.tier===d.baseTier&&Array.isArray(i.badges)&&i.badgeCount===i.badges.length;if(!ok)process.exitCode=1;}catch{process.exitCode=1;}});'
readonly V1_VALIDATOR='let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const d=JSON.parse(s),n=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b,i=d&&d.identity,ok=d&&typeof d==="object"&&d.maxScore===1000&&n(d.baseScore,0,400)&&typeof d.baseTier==="string"&&d.baseTier.length>0&&d.baseMaxScore===400&&n(d.compositeScore,0,1000)&&typeof d.compositeTier==="string"&&d.compositeTier.length>0&&d.compositeMaxScore===1000&&n(d.score,0,1000)&&d.score===d.compositeScore&&d.tier===d.compositeTier&&i&&typeof i==="object"&&i.score===d.baseScore&&i.maxScore===400&&i.tier===d.baseTier&&Array.isArray(i.badges)&&i.badgeCount===i.badges.length;if(!ok)process.exitCode=1;}catch{process.exitCode=1;}});'
readonly ATTEST_VALIDATOR='let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const d=JSON.parse(s),t=d&&d.title,ok=typeof t==="string"&&t.startsWith("Attest Base Identity Score:")&&t.includes("/400");if(!ok)process.exitCode=1;}catch{process.exitCode=1;}});'

# The legacy call intentionally runs first: it performs the potentially slow
# first scan and indexes the fixed public address for the v1 contract check.
check_with_retries \
  "$BASE_URL/api/reputation?address=$TEST_ADDRESS" \
  "$LEGACY_VALIDATOR" \
  6 90 10

check_with_retries \
  "$BASE_URL/api/v1/reputation/$TEST_ADDRESS" \
  "$V1_VALIDATOR" \
  6 30 5

check_with_retries \
  "$BASE_URL/api/actions/attest?address=$TEST_ADDRESS" \
  "$ATTEST_VALIDATOR" \
  4 90 10

systemctl is-active --quiet "$SERVICE"
json_ok "$BASE_URL/health" 15 "$HEALTH_VALIDATOR"

write_marker 'PASS'
rollback_armed=0

exit 0
