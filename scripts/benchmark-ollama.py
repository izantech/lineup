#!/usr/bin/env python3
"""
Lineup Runtime Engine Benchmark (Ollama + tmux)

Measures quality, speed, and cost of the orchestrator-driven pipeline
using local Ollama models instead of Anthropic API.

Opens a tmux split pane automatically to show claude sessions live.
Works both from inside and outside tmux.

NOTE: Default models and --auto-models presets are tuned for a Mac Studio
with an Apple M3 Ultra and 96GB unified memory. On machines with less RAM,
use smaller models (e.g. --model qwen3.5:9b) or adjust --model-simple,
--model-moderate, --model-complex to fit your hardware. The 51GB default
model requires ~55GB free memory; the 18GB moderate model needs ~20GB.

Usage:
  ./scripts/benchmark-ollama.py [options]

Options:
  --model <name>       Ollama model to use (default: qwen3-coder-next:q4_K_M)
  --auto-models        Use recommended models per complexity level
  --model-simple <n>   Model for simple tasks (default with --auto-models: qwen3.5:9b)
  --model-moderate <n> Model for moderate tasks (default with --auto-models: qwen3-coder:30b)
  --model-complex <n>  Model for complex tasks (default with --auto-models: qwen3-coder-next:q4_K_M)
  --task <file>        Task description file (default: built-in sample tasks)
  --runs <n>           Number of runs per task (default: 1)
  --project <path>     Project directory to run against (default: current dir)
  --output <dir>       Where to write benchmark results (default: .lineup/.benchmark)
  --skip-old           Skip the old orchestrator baseline runs
  --skip-new           Skip the new TF-based runs
"""

import argparse
import atexit
import json
import os
import tomllib
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

# --- Load config ---
_CONFIG_PATH = Path(__file__).parent / "benchmark-defaults.toml"
with open(_CONFIG_PATH, "rb") as _f:
    _CONF = tomllib.load(_f)

DEFAULT_MODEL = _CONF["models"]["default"]
DEFAULT_MODELS_BY_COMPLEXITY = {
    k: _CONF["models"][k] for k in ("simple", "moderate", "complex")
}
DEFAULT_TOOLS_PLAN = _CONF["tools"]["plan"]
DEFAULT_TOOLS_FULL = _CONF["tools"]["full"]
DEFAULT_TIMEOUT = _CONF["benchmark"]["timeout"]
DEFAULT_AGENT = _CONF["benchmark"]["agent"]
AGENTS = _CONF["agents"]


def _load_agent(name: str) -> dict:
    """Load an agent profile by name."""
    if name not in AGENTS:
        available = ", ".join(AGENTS.keys())
        print(f"ERROR: Unknown agent '{name}'. Available: {available}")
        sys.exit(1)
    return AGENTS[name]


# Resolve active agent (can be overridden by --agent flag later)
_AGENT = _load_agent(DEFAULT_AGENT)
AGENT_CMD = _AGENT["command"]
AGENT_PRINT_FLAGS = _AGENT["print_flags"]
AGENT_PERMISSION_FLAGS = _AGENT.get("permission_flags", [])
AGENT_ENV = _AGENT.get("env", {})
AGENT_MODEL_FLAG = _AGENT.get("model_flag", "--model")
AGENT_TOOLS_FLAG = _AGENT.get("tools_flag", "")
AGENT_PROMPT_FLAG = _AGENT.get("prompt_flag", "-p")
OLLAMA_BASE = AGENT_ENV.get("ANTHROPIC_BASE_URL",
              AGENT_ENV.get("OPENAI_BASE_URL", "http://localhost:11434")).rstrip("/v1")

SAMPLE_TASKS = [
    (t["complexity"], t["description"]) for t in _CONF["tasks"]
]


# --- Dataclasses ---
@dataclass
class BenchmarkConfig:
    model: str = DEFAULT_MODEL
    model_simple: str = ""
    model_moderate: str = ""
    model_complex: str = ""
    task_file: str = ""
    runs: int = 1
    project: str = ""
    output: str = ""
    skip_old: bool = False
    skip_new: bool = False

    def __post_init__(self):
        if not self.project:
            self.project = str(Path.cwd())

    def model_for(self, complexity: str) -> str:
        """Return the model for a given complexity level."""
        by_complexity = {
            "simple": self.model_simple,
            "moderate": self.model_moderate,
            "complex": self.model_complex,
        }
        return by_complexity.get(complexity) or self.model


@dataclass
class RunMetrics:
    duration_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    success: bool = False


# --- Main class ---
class OllamaBenchmark:
    def __init__(self, config: BenchmarkConfig):
        self.config = config
        self.worker_pane: str = ""
        self.results_dir: Path = Path()
        self.summary_file: Path = Path()
        self.console = Console()
        self._agent_path: str = AGENT_CMD

    def run(self) -> None:
        self.check_prerequisites()
        self.setup_worker_pane()
        self.setup_output()

        atexit.register(self.cleanup)
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

        self.console.print("\n[bold]=== Starting Benchmark ===[/bold]")

        tasks = []
        if self.config.task_file and Path(self.config.task_file).is_file():
            with open(self.config.task_file) as f:
                for line in f:
                    line = line.strip()
                    if line and "|" in line:
                        complexity, desc = line.split("|", 1)
                        tasks.append((complexity.strip(), desc.strip()))
        else:
            tasks = list(SAMPLE_TASKS)

        for idx, (complexity, task_desc) in enumerate(tasks, 1):
            self.benchmark_task(complexity, task_desc, idx)

        self.summarize_results()

        self.console.print("\n[bold]=== Benchmark Complete ===[/bold]")
        self.console.print(f"Results: {self.results_dir}")
        self.console.print(f"Summary: {self.summary_file}")

    def _signal_handler(self, signum, frame):
        self.cleanup()
        sys.exit(0)

    def check_prerequisites(self) -> None:
        self.console.print("[bold]=== Preflight Checks ===[/bold]")

        for tool in ["ollama", "tmux", AGENT_CMD]:
            if not shutil.which(tool):
                self.console.print(f"[red]ERROR: {tool} not found[/red]")
                sys.exit(1)

        agent_path = shutil.which(AGENT_CMD)
        if agent_path:
            self._agent_path = agent_path

        # Check if ollama is running
        result = subprocess.run(["ollama", "list"], capture_output=True, text=True)
        if result.returncode != 0:
            self.console.print("Starting ollama serve...")
            subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(3)
            result = subprocess.run(["ollama", "list"], capture_output=True, text=True)

        # Validate all configured models
        models_to_check = {self.config.model}
        for complexity in ("simple", "moderate", "complex"):
            m = self.config.model_for(complexity)
            models_to_check.add(m)

        for model in models_to_check:
            model_base = model.split(":")[0]
            if model_base not in result.stdout:
                self.console.print(f"[red]ERROR: Model '{model}' not found. Run: ollama pull {model}[/red]")
                sys.exit(1)

        # Show model configuration
        self.console.print(f"  Agent:   {AGENT_CMD} ({self._agent_path})")
        models_unique = set(self.config.model_for(c) for c in ("simple", "moderate", "complex"))
        if len(models_unique) > 1:
            self.console.print("  Models:")
            for c in ("simple", "moderate", "complex"):
                self.console.print(f"    {c:10s} {self.config.model_for(c)}")
        else:
            self.console.print(f"  Model:   {self.config.model}")
        self.console.print(f"  Runs:    {self.config.runs} per task")
        self.console.print(f"  Project: {self.config.project}")
        self.console.print(f"  Output:  {self.config.output}")
        self.console.print("")

    def setup_worker_pane(self) -> None:
        if os.environ.get("TMUX"):
            result = subprocess.run(
                ["tmux", "split-window", "-h", "-d", "-P", "-F", "#{pane_id}",
                 "echo '⏳ Waiting for first task...'; sleep 86400"],
                capture_output=True, text=True, check=True,
            )
            self.worker_pane = result.stdout.strip()
        else:
            subprocess.run(["tmux", "kill-session", "-t", "lineup-bench"], capture_output=True)
            subprocess.run(
                ["tmux", "new-session", "-d", "-s", "lineup-bench", "-n", "bench",
                 "echo '⏳ Waiting for first task...'; sleep 86400"],
                check=True,
            )
            result = subprocess.run(
                ["tmux", "split-window", "-t", "lineup-bench:bench", "-h", "-d",
                 "-P", "-F", "#{pane_id}",
                 "echo '⏳ Waiting for first task...'; sleep 86400"],
                capture_output=True, text=True, check=True,
            )
            self.worker_pane = result.stdout.strip()
            self.console.print("")
            self.console.print("  📺 Watch live: tmux attach -t lineup-bench")
            self.console.print("")

        # Keep pane alive after runner exits so respawn-pane works across tasks
        subprocess.run(
            ["tmux", "set-option", "-t", self.worker_pane, "remain-on-exit", "on"],
            capture_output=True,
        )

    def worker_run(self, runner: Path, done: Path, timeout: int = DEFAULT_TIMEOUT) -> None:
        subprocess.run(
            ["tmux", "respawn-pane", "-t", self.worker_pane, "-k", f"bash {shlex.quote(str(runner))}"],
            check=True,
        )
        deadline = time.monotonic() + timeout
        while not done.exists():
            if time.monotonic() > deadline:
                raise TimeoutError(f"worker timed out after {timeout}s")
            time.sleep(0.5)
        done.unlink()

    def cleanup(self) -> None:
        subprocess.run(
            ["pkill", "-f", f"ANTHROPIC_AUTH_TOKEN=.*{AGENT_CMD}.*--model"],
            capture_output=True,
        )
        if self.worker_pane:
            subprocess.run(["tmux", "send-keys", "-t", self.worker_pane, "C-c", ""], capture_output=True)
            time.sleep(0.3)
            subprocess.run(["tmux", "kill-pane", "-t", self.worker_pane], capture_output=True)
        if not os.environ.get("TMUX"):
            subprocess.run(["tmux", "kill-session", "-t", "lineup-bench"], capture_output=True)

    def setup_output(self) -> None:
        run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.results_dir = Path(self.config.output) / run_id
        self.results_dir.mkdir(parents=True, exist_ok=True)
        self.summary_file = self.results_dir / "summary.md"
        self.summary_file.write_text(
            f"# Benchmark Results — {run_id}\n\n"
            f"Model: `{self.config.model}`\n"
            f"Runs per task: {self.config.runs}\n"
            f"Project: `{self.config.project}`\n\n"
        )

    def _ollama_get(self, path: str, body: dict = None) -> dict:
        url = f"{OLLAMA_BASE}{path}"
        data = json.dumps(body).encode() if body else None
        headers = {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(url, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())

    def _is_model_loaded(self, model: str = "") -> bool:
        model = model or self.config.model
        try:
            resp = self._ollama_get("/api/ps")
            resp_text = json.dumps(resp)
            return model in resp_text
        except Exception:
            return False

    def get_model_size_gb(self, model: str = "") -> float:
        model = model or self.config.model
        try:
            result = subprocess.run(
                ["ollama", "list"], capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.splitlines():
                if model in line:
                    parts = line.split()
                    for i, part in enumerate(parts):
                        if part == "GB" and i > 0:
                            return float(parts[i - 1])
                        if part == "MB" and i > 0:
                            return float(parts[i - 1]) / 1000
            return 0.0
        except Exception:
            return 0.0

    def wait_with_progress(self, done: Path, size_gb: float, label: str, model: str = "", timeout: int = DEFAULT_TIMEOUT) -> None:
        model = model or self.config.model
        deadline = time.monotonic() + timeout
        model_loaded = self._is_model_loaded(model)

        if model_loaded:
            self.console.print(f"   Model already in memory ({size_gb:.1f}GB)")

        with Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            TimeElapsedColumn(),
            console=self.console,
        ) as progress:
            if not model_loaded:
                load_task = progress.add_task(
                    f"Loading {model} ({size_gb:.1f}GB)...", total=None,
                )
            run_task = progress.add_task(f"Running {label}...", total=None)

            while not done.exists():
                if time.monotonic() > deadline:
                    raise TimeoutError(f"worker timed out after {timeout}s")
                if not model_loaded:
                    model_loaded = self._is_model_loaded(model)
                    if model_loaded:
                        progress.update(load_task, description=f"Loaded {model} ({size_gb:.1f}GB)")
                        progress.stop_task(load_task)
                time.sleep(0.5)

        if done.exists():
            done.unlink()

    def run_ollama_claude(
        self,
        prompt: str,
        label: str,
        run_dir: Path,
        model: str = "",
        tools: str = DEFAULT_TOOLS_FULL,
        pane_title: str = "claude",
    ) -> RunMetrics:
        model = model or self.config.model
        json_file = run_dir / f"{label}.json"
        output_file = run_dir / f"{label}.txt"
        stderr_file = run_dir / f"{label}.stderr"
        exitcode_file = run_dir / f"{label}.exitcode"
        done_marker = run_dir / f".done-{label}"
        prompt_file = run_dir / f"{label}.prompt"

        done_marker.unlink(missing_ok=True)
        json_file.unlink(missing_ok=True)

        start_ts = int(time.time() * 1000)

        prompt_file.write_text(prompt)

        size_gb = self.get_model_size_gb(model)
        size_gb_str = f"{size_gb:.1f}"

        # Build env exports
        env_lines = "".join(
            f"export {k}={shlex.quote(v)}\n" for k, v in AGENT_ENV.items()
        )

        # Build agent command from profile flags
        agent_args = [shlex.quote(self._agent_path)]
        if AGENT_MODEL_FLAG:
            agent_args.append(f"{AGENT_MODEL_FLAG} {shlex.quote(model)}")
        agent_args.extend(AGENT_PRINT_FLAGS)
        if AGENT_TOOLS_FLAG and tools:
            agent_args.append(f"{AGENT_TOOLS_FLAG} {shlex.quote(tools)}")
        agent_args.extend(AGENT_PERMISSION_FLAGS)
        if AGENT_PROMPT_FLAG:
            agent_args.append(f"{AGENT_PROMPT_FLAG} \"$(cat {shlex.quote(str(prompt_file))})\"")
        agent_cmd = " \\\n  ".join(agent_args)
        # Agents without prompt_flag read from stdin
        if not AGENT_PROMPT_FLAG:
            agent_cmd += f" < {shlex.quote(str(prompt_file))}"

        runner = run_dir / f"{label}-runner.sh"
        runner.write_text(
            "#!/usr/bin/env bash\n"
            f"cd {shlex.quote(self.config.project)}\n"
            "printf '┌──────────────────────────────────────────┐\\n'\n"
            f"printf '│  {pane_title}\\n'\n"
            f"printf '│  Model: {model} ({size_gb_str}GB)\\n'\n"
            f"printf '│  Agent: {AGENT_CMD}\\n'\n"
            "printf '└──────────────────────────────────────────┘\\n\\n'\n"
            f"{env_lines}"
            f"{agent_cmd} \\\n"
            f"  2>{shlex.quote(str(stderr_file))} | tee {shlex.quote(str(json_file))}\n"
            f"echo ${{PIPESTATUS[0]}} > {shlex.quote(str(exitcode_file))}\n"
            f"touch {shlex.quote(str(done_marker))}\n"
            "printf '\\n✅ Complete\\n'\n"
        )
        runner.chmod(0o755)

        subprocess.run(
            ["tmux", "respawn-pane", "-t", self.worker_pane, "-k", f"bash {shlex.quote(str(runner))}"],
            check=True,
        )

        self.wait_with_progress(done_marker, size_gb, label, model=model)

        end_ts = int(time.time() * 1000)
        duration_ms = end_ts - start_ts

        input_tokens = 0
        output_tokens = 0
        success = False

        if json_file.exists() and json_file.stat().st_size > 0:
            try:
                # stream-json outputs JSONL — find the result line
                for line in reversed(json_file.read_text().strip().splitlines()):
                    data = json.loads(line)
                    if data.get("type") == "result":
                        result_text = data.get("result", "NO_RESULT")
                        output_file.write_text(result_text)
                        input_tokens = data.get("usage", {}).get("input_tokens", 0) or 0
                        output_tokens = data.get("usage", {}).get("output_tokens", 0) or 0
                        success = bool(result_text and result_text != "NO_RESULT")
                        break
            except Exception:
                shutil.copy2(json_file, output_file)

        exit_code = 0
        if exitcode_file.exists():
            try:
                exit_code = int(exitcode_file.read_text().strip())
            except Exception:
                exit_code = 1

        (run_dir / f"{label}.metrics").write_text(f"{duration_ms}|{input_tokens}|{output_tokens}")

        return RunMetrics(
            duration_ms=duration_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            success=success and exit_code == 0,
        )

    def run_tf_in_pane(
        self,
        config_file: Path,
        input_file: Path,
        run_dir: Path,
        pane_title: str = "tf",
    ) -> int:
        done_marker = run_dir / ".done-tf"
        exitcode_file = run_dir / "tf.exitcode"
        done_marker.unlink(missing_ok=True)

        runner = run_dir / "tf-runner.sh"
        runner.write_text(
            "#!/usr/bin/env bash\n"
            f"cd {shlex.quote(self.config.project)}\n"
            "printf '┌──────────────────────────────────────────┐\\n'\n"
            f"printf '│  {pane_title}\\n'\n"
            "printf '│  task-foundry\\n'\n"
            "printf '└──────────────────────────────────────────┘\\n\\n'\n"
            "printf '🔧 Running task-foundry...\\n\\n'\n"
            f"task-foundry --config {shlex.quote(str(config_file))} --input-file {shlex.quote(str(input_file))} 2>&1\n"
            f"echo $? > {shlex.quote(str(exitcode_file))}\n"
            f"touch {shlex.quote(str(done_marker))}\n"
            "printf '\\n✅ Complete\\n'\n"
        )
        runner.chmod(0o755)

        subprocess.run(
            ["tmux", "respawn-pane", "-t", self.worker_pane, "-k", f"bash {shlex.quote(str(runner))}"],
            check=True,
        )

        deadline = time.monotonic() + DEFAULT_TIMEOUT
        while not done_marker.exists():
            if time.monotonic() > deadline:
                raise TimeoutError(f"tf worker timed out after {DEFAULT_TIMEOUT}s")
            time.sleep(0.5)
        done_marker.unlink()

        if exitcode_file.exists():
            try:
                return int(exitcode_file.read_text().strip())
            except Exception:
                return 1
        return 0

    def benchmark_task(self, complexity: str, task_desc: str, task_idx: int) -> None:
        task_model = self.config.model_for(complexity)
        self.console.print(f"\n[bold]━━━ Task {task_idx}: [{complexity}] model={task_model} ━━━[/bold]")
        self.console.print(f"    {task_desc}\n")

        task_dir = self.results_dir / f"task-{task_idx}-{complexity}"
        task_dir.mkdir(parents=True, exist_ok=True)
        (task_dir / "task.txt").write_text(task_desc)

        if not self.config.skip_new:
            self.console.print(f"  [NEW] TF-based pipeline ({self.config.runs} runs)")
            for i in range(1, self.config.runs + 1):
                run_dir = task_dir / f"new-run-{i}"
                run_dir.mkdir(parents=True, exist_ok=True)

                self.console.print(f"    Run {i}/{self.config.runs} ", end="")

                gen_start = int(time.time() * 1000)
                try:
                    subprocess.run(
                        ["npx", "lineup", "tf", "generate", "--host", "claude",
                         "--output", str(run_dir / "tf-artifacts/")],
                        cwd=self.config.project,
                        capture_output=True,
                    )
                except Exception:
                    pass
                gen_end = int(time.time() * 1000)
                gen_duration = gen_end - gen_start
                self.console.print(f"[gen:{gen_duration}ms] ", end="")

                plan_prompt = (
                    "You are an architect agent. Analyze this task and produce a TaskManifest YAML.\n\n"
                    f"Task: {task_desc}\n\n"
                    "Output ONLY a TaskManifest YAML with this structure:\n"
                    "version: 1\n"
                    "goal: \"<one-line goal>\"\n"
                    "tasks:\n"
                    "  - task_id: <short-kebab-id>\n"
                    "    description: \"<what this task does>\"\n"
                    "    depends_on: [<task_ids this depends on>]\n"
                    "    read_files: [<files to read>]\n"
                    "    write_files: [<files to create or modify>]\n"
                    "    steps:\n"
                    "      - <imperative step description>\n\n"
                    "Read the relevant files first, then produce the manifest."
                )

                try:
                    plan_metrics = self.run_ollama_claude(
                        plan_prompt, "plan", run_dir,
                        model=task_model,
                        tools=DEFAULT_TOOLS_PLAN,
                        pane_title=f"T{task_idx}:NEW:plan",
                    )
                    self.console.print(f"[plan:{plan_metrics.duration_ms}ms] ", end="")
                except TimeoutError:
                    self.console.print("[red][plan:TIMEOUT][/red]")
                    continue

                tf_duration = 0
                tf_config = run_dir / "tf-artifacts" / "tf-config.yaml"
                if shutil.which("task-foundry") and tf_config.exists():
                    tf_start = int(time.time() * 1000)
                    self.run_tf_in_pane(tf_config, task_dir / "task.txt", run_dir, f"T{task_idx}:NEW:tf")
                    tf_end = int(time.time() * 1000)
                    tf_duration = tf_end - tf_start
                    self.console.print(f"[tf:{tf_duration}ms] ", end="")
                else:
                    self.console.print("[tf:skipped] ", end="")

                total_duration = gen_duration + plan_metrics.duration_ms + tf_duration
                (run_dir / "timing.txt").write_text(
                    f"{gen_duration}|{plan_metrics.duration_ms}|{tf_duration}|{total_duration}"
                )
                self.console.print(f"= {total_duration}ms")

        if not self.config.skip_old:
            self.console.print(f"  [OLD] Full orchestrator ({self.config.runs} runs)")
            for i in range(1, self.config.runs + 1):
                run_dir = task_dir / f"old-run-{i}"
                run_dir.mkdir(parents=True, exist_ok=True)

                self.console.print(f"    Run {i}/{self.config.runs} ", end="")

                old_prompt = (
                    "You are a senior developer. Complete this task step by step:\n"
                    "1. Read and understand the relevant code\n"
                    "2. Plan the changes needed\n"
                    "3. Implement the changes\n"
                    "4. Verify the changes compile/work\n\n"
                    f"Task: {task_desc}\n\n"
                    "Work through each step methodically."
                )

                try:
                    old_metrics = self.run_ollama_claude(
                        old_prompt, "full", run_dir,
                        model=task_model,
                        tools=DEFAULT_TOOLS_FULL,
                        pane_title=f"T{task_idx}:OLD:full",
                    )
                    (run_dir / "timing.txt").write_text(str(old_metrics.duration_ms))
                    self.console.print(f"= {old_metrics.duration_ms}ms")
                except TimeoutError:
                    self.console.print(f"[red]= TIMEOUT ({DEFAULT_TIMEOUT}s)[/red]")

    def summarize_results(self) -> None:
        self.console.print("\n[bold]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/bold]")
        self.console.print("[bold]               RESULTS[/bold]")
        self.console.print("[bold]━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━[/bold]")

        table = Table(show_header=True, header_style="bold")
        table.add_column("Task")
        table.add_column("Complexity")
        table.add_column("Model")
        table.add_column("System")
        table.add_column("Avg Time (s)")
        table.add_column("Input Tokens")
        table.add_column("Output Tokens")
        table.add_column("Success")

        md_rows: list[str] = []
        md_rows.append("| Task | Complexity | Model | System | Avg Time (s) | Input Tokens | Output Tokens | Success |")
        md_rows.append("|------|-----------|-------|--------|-------------|-------------|--------------|---------|")

        for task_dir in sorted(self.results_dir.glob("task-*")):
            if not task_dir.is_dir():
                continue
            name = task_dir.name
            parts = name.split("-", 2)
            task_idx = parts[1] if len(parts) > 1 else "?"
            complexity = parts[2] if len(parts) > 2 else "?"

            if not self.config.skip_new:
                new_times, new_input, new_output, new_success, new_total = [], [], [], 0, 0
                for run_dir in sorted(task_dir.glob("new-run-*")):
                    timing = run_dir / "timing.txt"
                    if timing.exists():
                        parts_t = timing.read_text().strip().split("|")
                        new_times.append(int(parts_t[3]) if len(parts_t) >= 4 else 0)
                        new_total += 1
                    metrics = run_dir / "plan.metrics"
                    if metrics.exists():
                        m = metrics.read_text().strip().split("|")
                        if len(m) >= 3:
                            new_input.append(int(m[1]))
                            new_output.append(int(m[2]))
                    plan_txt = run_dir / "plan.txt"
                    if plan_txt.exists() and plan_txt.stat().st_size > 0:
                        new_success += 1
                if new_times:
                    avg_time = sum(new_times) // len(new_times) // 1000
                    avg_in = sum(new_input) // len(new_input) if new_input else 0
                    avg_out = sum(new_output) // len(new_output) if new_output else 0
                    task_model = self.config.model_for(complexity)
                    model_short = task_model.split(":")[0]
                    table.add_row(task_idx, complexity, model_short, "NEW (TF)", f"{avg_time}s", str(avg_in), str(avg_out), f"{new_success}/{new_total}")
                    md_rows.append(f"| {task_idx} | {complexity} | {model_short} | NEW (TF) | {avg_time}s | {avg_in} | {avg_out} | {new_success}/{new_total} |")

            if not self.config.skip_old:
                old_times, old_input, old_output, old_success, old_total = [], [], [], 0, 0
                for run_dir in sorted(task_dir.glob("old-run-*")):
                    timing = run_dir / "timing.txt"
                    if timing.exists():
                        try:
                            old_times.append(int(timing.read_text().strip()))
                            old_total += 1
                        except Exception:
                            pass
                    metrics = run_dir / "full.metrics"
                    if metrics.exists():
                        m = metrics.read_text().strip().split("|")
                        if len(m) >= 3:
                            old_input.append(int(m[1]))
                            old_output.append(int(m[2]))
                    full_txt = run_dir / "full.txt"
                    if full_txt.exists() and full_txt.stat().st_size > 0:
                        old_success += 1
                if old_times:
                    avg_time = sum(old_times) // len(old_times) // 1000
                    avg_in = sum(old_input) // len(old_input) if old_input else 0
                    avg_out = sum(old_output) // len(old_output) if old_output else 0
                    task_model = self.config.model_for(complexity)
                    model_short = task_model.split(":")[0]
                    table.add_row(task_idx, complexity, model_short, "OLD (orch)", f"{avg_time}s", str(avg_in), str(avg_out), f"{old_success}/{old_total}")
                    md_rows.append(f"| {task_idx} | {complexity} | {model_short} | OLD (orch) | {avg_time}s | {avg_in} | {avg_out} | {old_success}/{old_total} |")

        self.console.print(table)

        with open(self.summary_file, "a") as f:
            f.write("\n".join(md_rows) + "\n\n")


# --- Argument parsing ---
def parse_args() -> BenchmarkConfig:
    parser = argparse.ArgumentParser(
        description="Lineup Runtime Engine Benchmark (Ollama + tmux)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    available_agents = ", ".join(AGENTS.keys())
    parser.add_argument("--agent", default=DEFAULT_AGENT, help=f"Agent to use ({available_agents})")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Ollama model to use (fallback for all complexities)")
    parser.add_argument("--model-simple", default="", help="Model for simple tasks (default: qwen3.5:9b)")
    parser.add_argument("--model-moderate", default="", help="Model for moderate tasks (default: qwen3-coder:30b)")
    parser.add_argument("--model-complex", default="", help="Model for complex tasks (default: qwen3-coder-next:q4_K_M)")
    parser.add_argument("--auto-models", action="store_true", help="Use recommended models per complexity level")
    parser.add_argument("--task", dest="task_file", default="", help="Task description file")
    parser.add_argument("--runs", type=int, default=1, help="Number of runs per task")
    parser.add_argument("--project", default="", help="Project directory to run against")
    parser.add_argument("--output", default=_CONF["benchmark"]["output"], help="Where to write benchmark results")
    parser.add_argument("--skip-old", action="store_true", help="Skip the old orchestrator baseline runs")
    parser.add_argument("--skip-new", action="store_true", help="Skip the new TF-based runs")

    args = parser.parse_args()

    # Reload agent profile if --agent differs from default
    if args.agent != DEFAULT_AGENT:
        global AGENT_CMD, AGENT_PRINT_FLAGS, AGENT_PERMISSION_FLAGS, AGENT_ENV
        global AGENT_MODEL_FLAG, AGENT_TOOLS_FLAG, AGENT_PROMPT_FLAG, OLLAMA_BASE, _AGENT
        _AGENT = _load_agent(args.agent)
        AGENT_CMD = _AGENT["command"]
        AGENT_PRINT_FLAGS = _AGENT["print_flags"]
        AGENT_PERMISSION_FLAGS = _AGENT.get("permission_flags", [])
        AGENT_ENV = _AGENT.get("env", {})
        AGENT_MODEL_FLAG = _AGENT.get("model_flag", "--model")
        AGENT_TOOLS_FLAG = _AGENT.get("tools_flag", "")
        AGENT_PROMPT_FLAG = _AGENT.get("prompt_flag", "-p")
        OLLAMA_BASE = AGENT_ENV.get("ANTHROPIC_BASE_URL",
                      AGENT_ENV.get("OPENAI_BASE_URL", "http://localhost:11434")).rstrip("/v1")

    # Resolve per-complexity models
    model_simple = args.model_simple
    model_moderate = args.model_moderate
    model_complex = args.model_complex
    if args.auto_models:
        model_simple = model_simple or DEFAULT_MODELS_BY_COMPLEXITY["simple"]
        model_moderate = model_moderate or DEFAULT_MODELS_BY_COMPLEXITY["moderate"]
        model_complex = model_complex or DEFAULT_MODELS_BY_COMPLEXITY["complex"]

    return BenchmarkConfig(
        model=args.model,
        model_simple=model_simple,
        model_moderate=model_moderate,
        model_complex=model_complex,
        task_file=args.task_file,
        runs=args.runs,
        project=args.project or str(Path.cwd()),
        output=args.output,
        skip_old=args.skip_old,
        skip_new=args.skip_new,
    )


def main() -> None:
    config = parse_args()
    benchmark = OllamaBenchmark(config)
    benchmark.run()


if __name__ == "__main__":
    main()
