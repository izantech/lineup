#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Lineup Runtime Engine Benchmark (Ollama + tmux)
#
# Measures quality, speed, and cost of the orchestrator-driven pipeline
# using local Ollama models instead of Anthropic API.
#
# Opens a tmux split pane automatically to show claude sessions live.
# Works both from inside and outside tmux.
#
# Usage:
#   ./scripts/benchmark-ollama.sh [options]
#
# Options:
#   --model <name>       Ollama model to use (default: qwen3-coder-next:q4_K_M)
#   --task <file>        Task description file (default: built-in sample tasks)
#   --runs <n>           Number of runs per task (default: 3)
#   --project <path>     Project directory to run against (default: current dir)
#   --output <dir>       Where to write benchmark results (default: .lineup/.benchmark/)
#   --skip-old           Skip the old orchestrator baseline runs
#   --skip-new           Skip the new TF-based runs
# ============================================================================

# --- Defaults ---
MODEL="${MODEL:-qwen3-coder-next:q4_K_M}"
RUNS=1
PROJECT_DIR="$(pwd)"
OUTPUT_DIR=".lineup/.benchmark"
SKIP_OLD=false
SKIP_NEW=false
TASK_FILE=""

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)    MODEL="$2"; shift 2 ;;
    --task)     TASK_FILE="$2"; shift 2 ;;
    --runs)     RUNS="$2"; shift 2 ;;
    --project)  PROJECT_DIR="$2"; shift 2 ;;
    --output)   OUTPUT_DIR="$2"; shift 2 ;;
    --skip-old) SKIP_OLD=true; shift ;;
    --skip-new) SKIP_NEW=true; shift ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
  esac
done

now_ms() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

# --- Sample tasks ---
declare -a SAMPLE_TASKS=(
  "simple|Add a helper function 'capitalize' to src/lib/utils.ts that capitalizes the first letter of a string, and add a test for it"
  "moderate|Refactor the expression evaluator in cli/src/lib/expression.ts to support a new 'not' boolean operator, update tests"
  "complex|Add a --timeout flag to the lineup run command that kills TF after N seconds, with proper cleanup of ephemeral artifacts"
)

# ============================================================================
# TMUX BOOTSTRAP
#
# If we're not inside tmux, create a new session with a left pane (control)
# and a right pane (worker view), then re-exec ourselves inside the left pane.
#
# If we're already inside tmux, create the worker pane as a split of the
# current window.
# ============================================================================
WORKER_PANE=""

setup_worker_pane() {
  if [ -n "${TMUX:-}" ]; then
    # Already inside tmux — split current window, use positional index
    tmux split-window -h -d "echo '⏳ Waiting for first task...'; sleep 86400"
    # Worker is always the second pane in the current window
    local current_window
    current_window="$(tmux display-message -p '#{session_name}:#{window_index}')"
    WORKER_PANE="${current_window}.1"
  else
    # Not in tmux — create a session with two panes
    tmux kill-session -t lineup-bench 2>/dev/null || true
    tmux new-session -d -s lineup-bench -n bench \
      "echo '⏳ Waiting for first task...'; sleep 86400"
    tmux split-window -t lineup-bench:bench -h -d \
      "echo '⏳ Waiting for first task...'; sleep 86400"
    # Pane 0 = left (unused), Pane 1 = right (worker)
    WORKER_PANE="lineup-bench:bench.1"
    echo ""
    echo "  📺 Watch live: tmux attach -t lineup-bench"
    echo ""
  fi
}

# Run a script in the worker pane by respawning it
worker_run() {
  local runner_script="$1"
  local done_marker="$2"

  # Respawn the pane with the new command (kills whatever was running)
  tmux respawn-pane -t "$WORKER_PANE" -k "bash '$runner_script'"

  # Poll for completion
  while [ ! -f "$done_marker" ]; do
    sleep 2
  done
  rm -f "$done_marker"
}

cleanup() {
  echo ""
  echo "🧹 Cleaning up..."

  # Kill any running claude processes spawned by this benchmark
  pkill -f "ANTHROPIC_AUTH_TOKEN=ollama.*claude.*--bare" 2>/dev/null || true

  # Kill the worker pane
  if [ -n "$WORKER_PANE" ]; then
    tmux send-keys -t "$WORKER_PANE" C-c 2>/dev/null || true
    sleep 0.3
    tmux kill-pane -t "$WORKER_PANE" 2>/dev/null || true
  fi

  # Kill the background session if we created one
  if [ -z "${TMUX:-}" ]; then
    tmux kill-session -t lineup-bench 2>/dev/null || true
  fi

  # Keep the model loaded in Ollama memory for faster subsequent runs.
  # To unload manually: curl http://localhost:11434/api/generate -d '{"model":"<name>","keep_alive":0}'

  echo "  Done."
}

# --- Preflight checks ---
check_prerequisites() {
  echo "=== Preflight Checks ==="

  for tool in ollama tmux claude python3; do
    if ! command -v "$tool" &>/dev/null; then
      echo "ERROR: $tool not found"
      exit 1
    fi
  done

  if ! curl -sf http://localhost:11434/api/tags &>/dev/null; then
    echo "Starting ollama serve..."
    ollama serve &>/dev/null &
    sleep 3
  fi

  local model_check
  model_check="$(ollama list 2>/dev/null || true)"
  if ! echo "$model_check" | grep -q "${MODEL%%:*}"; then
    echo "ERROR: Model '$MODEL' not found. Run: ollama pull $MODEL"
    exit 1
  fi

  echo "  Model:   $MODEL"
  echo "  Runs:    $RUNS per task"
  echo "  Project: $PROJECT_DIR"
  echo "  Output:  $OUTPUT_DIR"
  echo ""
}

# --- Setup output dir ---
setup_output() {
  local run_id
  run_id="$(date +%Y%m%d-%H%M%S)"
  RESULTS_DIR="$OUTPUT_DIR/$run_id"
  mkdir -p "$RESULTS_DIR"
  SUMMARY_FILE="$RESULTS_DIR/summary.md"
  cat > "$SUMMARY_FILE" <<EOF
# Benchmark Results — $run_id

Model: \`$MODEL\`
Runs per task: $RUNS
Project: \`$PROJECT_DIR\`

EOF
}

# --- Run a claude session in the worker pane ---
run_ollama_claude() {
  local prompt="$1"
  local label="$2"
  local run_dir="$3"
  local allowed_tools="${4:-Read,Grep,Glob,Edit,Write,Bash}"
  local pane_title="${5:-claude}"

  local json_file="$run_dir/${label}.json"
  local output_file="$run_dir/${label}.txt"
  local done_marker="$run_dir/.done-${label}"
  local start_ts end_ts duration_ms

  rm -f "$done_marker" "$json_file"
  start_ts=$(now_ms)

  # Write prompt to file (avoids escaping hell)
  local prompt_file="$run_dir/${label}.prompt"
  printf '%s' "$prompt" > "$prompt_file"

  # Get model size for progress display
  local model_gb
  model_gb=$(curl -s http://localhost:11434/api/show -d "{\"model\":\"$MODEL\"}" 2>/dev/null \
    | grep -o '"size":[0-9]*' | head -1 | cut -d: -f2)
  model_gb=$(python3 -c "print(f'{${model_gb:-0}/1e9:.1f}')" 2>/dev/null || echo "?")

  # Build runner script
  local runner_script="$run_dir/${label}-runner.sh"
  cat > "$runner_script" <<RUNNER
#!/usr/bin/env bash
cd "$PROJECT_DIR"
echo "┌──────────────────────────────────────────┐"
echo "│  $pane_title"
echo "│  Model: $MODEL (${model_gb}GB)"
echo "└──────────────────────────────────────────┘"
echo ""

export ANTHROPIC_AUTH_TOKEN=ollama
export ANTHROPIC_BASE_URL=http://localhost:11434
export ANTHROPIC_API_KEY=""

# Check if model is already loaded
if curl -s http://localhost:11434/api/ps 2>/dev/null | grep -q "$MODEL"; then
  echo "✅ Model already in memory (${model_gb}GB)"
  echo ""
else
  echo "⏳ Loading ${model_gb}GB into memory..."
fi

# Run claude in background
claude \\
  --model "$MODEL" \\
  --print \\
  --bare \\
  --output-format json \\
  --allowedTools "$allowed_tools" \\
  --permission-mode acceptEdits \\
  -p "\$(cat '$prompt_file')" \\
  > "$json_file" 2>"$run_dir/${label}.stderr" &
claude_pid=\$!

# Poll until model appears in /api/ps (= fully loaded)
load_start=\$(python3 -c 'import time; print(int(time.time()))')
if ! curl -s http://localhost:11434/api/ps 2>/dev/null | grep -q "$MODEL"; then
  while kill -0 \$claude_pid 2>/dev/null; do
    if curl -s http://localhost:11434/api/ps 2>/dev/null | grep -q "$MODEL"; then
      break
    fi
    elapsed=\$(( \$(python3 -c 'import time; print(int(time.time()))') - load_start ))
    # Estimate ~1.2 GB/s load speed on Apple Silicon SSD
    loaded_est=\$(python3 -c "
e=\$elapsed; gb=${model_gb}
loaded=min(e*1.2, float(gb))
pct=loaded/float(gb)*100
bar_len=20
filled=int(pct/100*bar_len)
bar='█'*filled + '░'*(bar_len-filled)
print(f'{bar} {loaded:.1f}/{gb}GB ({pct:.0f}%)')
")
    printf "\r  %s  " "\$loaded_est"
    sleep 1
  done
  printf "\r✅ Model loaded (${model_gb}GB)                                         \n"
fi

echo ""
echo "🤖 Running..."
echo ""

# Stream stderr (tool calls, progress)
tail -f "$run_dir/${label}.stderr" 2>/dev/null &
tail_pid=\$!

wait \$claude_pid 2>/dev/null
echo \$? > "$run_dir/${label}.exitcode"
kill \$tail_pid 2>/dev/null || true

touch "$done_marker"
echo ""
echo "✅ Complete"
RUNNER
  chmod +x "$runner_script"

  # Run in worker pane
  worker_run "$runner_script" "$done_marker"

  end_ts=$(now_ms)
  duration_ms=$((end_ts - start_ts))

  # Extract results
  if command -v jq &>/dev/null && [ -s "$json_file" ]; then
    jq -r '.result // "NO_RESULT"' "$json_file" > "$output_file" 2>/dev/null || true
    local input_tokens output_tokens
    input_tokens=$(jq -r '.usage.input_tokens // 0' "$json_file" 2>/dev/null || echo 0)
    output_tokens=$(jq -r '.usage.output_tokens // 0' "$json_file" 2>/dev/null || echo 0)
    echo "${duration_ms}|${input_tokens}|${output_tokens}" > "$run_dir/${label}.metrics"
  else
    cp "$json_file" "$output_file" 2>/dev/null || true
    echo "${duration_ms}|0|0" > "$run_dir/${label}.metrics"
  fi

  echo "$duration_ms"
}

# --- Run TF in the worker pane ---
run_tf_in_pane() {
  local config="$1"
  local input_file="$2"
  local run_dir="$3"
  local pane_title="${4:-tf}"

  local done_marker="$run_dir/.done-tf"
  rm -f "$done_marker"

  local runner_script="$run_dir/tf-runner.sh"
  cat > "$runner_script" <<RUNNER
#!/usr/bin/env bash
cd "$PROJECT_DIR"
echo "┌──────────────────────────────────────────┐"
echo "│  $pane_title"
echo "│  task-foundry"
echo "└──────────────────────────────────────────┘"
echo ""
echo "🔧 Running task-foundry..."
echo ""
task-foundry --config "$config" --input-file "$input_file" 2>&1
echo \$? > "$run_dir/tf.exitcode"
touch "$done_marker"
echo ""
echo "✅ Complete"
RUNNER
  chmod +x "$runner_script"

  worker_run "$runner_script" "$done_marker"
}

# --- Run benchmark for a single task ---
benchmark_task() {
  local complexity="$1"
  local task_desc="$2"
  local task_idx="$3"

  echo ""
  echo "━━━ Task $task_idx: [$complexity] ━━━"
  echo "    $task_desc"
  echo ""

  local task_dir="$RESULTS_DIR/task-${task_idx}-${complexity}"
  mkdir -p "$task_dir"
  echo "$task_desc" > "$task_dir/task.txt"

  # --- New system (TF-based) ---
  if [ "$SKIP_NEW" = false ]; then
    echo "  [NEW] TF-based pipeline ($RUNS runs)"
    for i in $(seq 1 "$RUNS"); do
      local run_dir="$task_dir/new-run-$i"
      mkdir -p "$run_dir"

      echo -n "    Run $i/$RUNS "

      # Step 1: Generate TF artifacts
      local gen_start gen_end gen_duration
      gen_start=$(now_ms)
      (cd "$PROJECT_DIR" && npx lineup tf generate --host claude --output "$run_dir/tf-artifacts/" 2>/dev/null) || true
      gen_end=$(now_ms)
      gen_duration=$((gen_end - gen_start))
      echo -n "[gen:${gen_duration}ms] "

      # Step 2: Architect produces TaskManifest
      local plan_prompt
      plan_prompt="You are an architect agent. Analyze this task and produce a TaskManifest YAML.

Task: $task_desc

Output ONLY a TaskManifest YAML with this structure:
version: 1
goal: \"<one-line goal>\"
tasks:
  - task_id: <short-kebab-id>
    description: \"<what this task does>\"
    depends_on: [<task_ids this depends on>]
    read_files: [<files to read>]
    write_files: [<files to create or modify>]
    steps:
      - <imperative step description>

Read the relevant files first, then produce the manifest."

      local plan_duration
      plan_duration=$(run_ollama_claude "$plan_prompt" "plan" "$run_dir" "Read,Grep,Glob" "T${task_idx}:NEW:plan")
      echo -n "[plan:${plan_duration}ms] "

      # Step 3: Run TF if available
      local tf_duration=0
      if command -v task-foundry &>/dev/null && [ -f "$run_dir/tf-artifacts/tf-config.yaml" ]; then
        local tf_start tf_end
        tf_start=$(now_ms)
        run_tf_in_pane "$run_dir/tf-artifacts/tf-config.yaml" "$task_dir/task.txt" "$run_dir" "T${task_idx}:NEW:tf"
        tf_end=$(now_ms)
        tf_duration=$((tf_end - tf_start))
        echo -n "[tf:${tf_duration}ms] "
      else
        echo -n "[tf:skipped] "
      fi

      local total_duration=$((gen_duration + plan_duration + tf_duration))
      echo "${gen_duration}|${plan_duration}|${tf_duration}|${total_duration}" > "$run_dir/timing.txt"
      echo "= ${total_duration}ms"
    done
  fi

  # --- Old system (full orchestrator) ---
  if [ "$SKIP_OLD" = false ]; then
    echo "  [OLD] Full orchestrator ($RUNS runs)"
    for i in $(seq 1 "$RUNS"); do
      local run_dir="$task_dir/old-run-$i"
      mkdir -p "$run_dir"

      echo -n "    Run $i/$RUNS "

      local old_prompt="You are a senior developer. Complete this task step by step:
1. Read and understand the relevant code
2. Plan the changes needed
3. Implement the changes
4. Verify the changes compile/work

Task: $task_desc

Work through each step methodically."

      local old_duration
      old_duration=$(run_ollama_claude "$old_prompt" "full" "$run_dir" "Read,Grep,Glob,Edit,Write,Bash" "T${task_idx}:OLD:full")
      echo "$old_duration" > "$run_dir/timing.txt"
      echo "= ${old_duration}ms"
    done
  fi
}

# --- Collect and summarize results ---
summarize_results() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "               RESULTS"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "" | tee -a "$SUMMARY_FILE"
  echo "| Task | Complexity | System | Avg Time (s) | Input Tokens | Output Tokens | Success |" | tee -a "$SUMMARY_FILE"
  echo "|------|-----------|--------|-------------|-------------|--------------|---------|" | tee -a "$SUMMARY_FILE"

  for task_dir in "$RESULTS_DIR"/task-*/; do
    [ -d "$task_dir" ] || continue
    local complexity task_idx
    complexity=$(basename "$task_dir" | sed 's/task-[0-9]*-//')
    task_idx=$(basename "$task_dir" | sed 's/task-\([0-9]*\)-.*/\1/')

    if [ "$SKIP_NEW" = false ]; then
      local new_times=() new_input=() new_output=()
      for run_dir in "$task_dir"/new-run-*/; do
        [ -d "$run_dir" ] || continue
        [ -f "$run_dir/timing.txt" ] && new_times+=("$(cut -d'|' -f4 "$run_dir/timing.txt")")
        if [ -f "$run_dir/plan.metrics" ]; then
          new_input+=("$(cut -d'|' -f2 "$run_dir/plan.metrics")")
          new_output+=("$(cut -d'|' -f3 "$run_dir/plan.metrics")")
        fi
      done
      if [ ${#new_times[@]} -gt 0 ]; then
        local avg_time=0 avg_in=0 avg_out=0
        for t in "${new_times[@]}"; do avg_time=$((avg_time + t)); done
        avg_time=$((avg_time / ${#new_times[@]} / 1000))
        for t in "${new_input[@]:-0}"; do avg_in=$((avg_in + t)); done
        [ ${#new_input[@]} -gt 0 ] && avg_in=$((avg_in / ${#new_input[@]}))
        for t in "${new_output[@]:-0}"; do avg_out=$((avg_out + t)); done
        [ ${#new_output[@]} -gt 0 ] && avg_out=$((avg_out / ${#new_output[@]}))
        local success=0
        for rd in "$task_dir"/new-run-*/; do [ -s "$rd/plan.txt" ] && success=$((success + 1)); done
        echo "| $task_idx | $complexity | NEW (TF) | ${avg_time}s | $avg_in | $avg_out | ${success}/${#new_times[@]} |" | tee -a "$SUMMARY_FILE"
      fi
    fi

    if [ "$SKIP_OLD" = false ]; then
      local old_times=() old_input=() old_output=()
      for run_dir in "$task_dir"/old-run-*/; do
        [ -d "$run_dir" ] || continue
        [ -f "$run_dir/timing.txt" ] && old_times+=("$(cat "$run_dir/timing.txt")")
        if [ -f "$run_dir/full.metrics" ]; then
          old_input+=("$(cut -d'|' -f2 "$run_dir/full.metrics")")
          old_output+=("$(cut -d'|' -f3 "$run_dir/full.metrics")")
        fi
      done
      if [ ${#old_times[@]} -gt 0 ]; then
        local avg_time=0 avg_in=0 avg_out=0
        for t in "${old_times[@]}"; do avg_time=$((avg_time + t)); done
        avg_time=$((avg_time / ${#old_times[@]} / 1000))
        for t in "${old_input[@]:-0}"; do avg_in=$((avg_in + t)); done
        [ ${#old_input[@]} -gt 0 ] && avg_in=$((avg_in / ${#old_input[@]}))
        for t in "${old_output[@]:-0}"; do avg_out=$((avg_out + t)); done
        [ ${#old_output[@]} -gt 0 ] && avg_out=$((avg_out / ${#old_output[@]}))
        local success=0
        for rd in "$task_dir"/old-run-*/; do [ -s "$rd/full.txt" ] && success=$((success + 1)); done
        echo "| $task_idx | $complexity | OLD (orch) | ${avg_time}s | $avg_in | $avg_out | ${success}/${#old_times[@]} |" | tee -a "$SUMMARY_FILE"
      fi
    fi
  done

  echo "" | tee -a "$SUMMARY_FILE"
}

# --- Main ---
main() {
  check_prerequisites
  setup_worker_pane
  setup_output

  trap cleanup EXIT INT TERM

  echo "=== Starting Benchmark ==="

  local tasks=()
  if [ -n "$TASK_FILE" ] && [ -f "$TASK_FILE" ]; then
    while IFS= read -r line; do
      [ -n "$line" ] && tasks+=("$line")
    done < "$TASK_FILE"
  else
    tasks=("${SAMPLE_TASKS[@]}")
  fi

  local idx=1
  for task_entry in "${tasks[@]}"; do
    local complexity="${task_entry%%|*}"
    local task_desc="${task_entry#*|}"
    benchmark_task "$complexity" "$task_desc" "$idx"
    idx=$((idx + 1))
  done

  summarize_results

  echo ""
  echo "=== Benchmark Complete ==="
  echo "Results: $RESULTS_DIR"
  echo "Summary: $SUMMARY_FILE"
}

main "$@"
