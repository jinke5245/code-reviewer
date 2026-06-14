#!/usr/bin/env bash

set -euo pipefail

log() {
    printf '[devcontainer:post-create] %s\n' "$*"
}

warn_missing_env() {
    for var_name in "$@"; do
        if [[ -z "${!var_name:-}" ]]; then
            printf '[devcontainer:post-create] Optional environment variable is not set: %s\n' "${var_name}" >&2
        fi
    done
}

repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

require_command() {
    local command_name="$1"

    if ! command -v "${command_name}" >/dev/null 2>&1; then
        printf '[devcontainer:post-create] Missing required command: %s\n' "${command_name}" >&2
        exit 1
    fi
}

ensure_dependencies() {
    require_command pnpm

    if [[ -f node_modules/.modules.yaml ]]; then
        log "dependencies already installed"
        return
    fi

    log "pnpm modules metadata missing; installing dependencies"
    pnpm install --frozen-lockfile
}

print_tool_versions() {
    require_command node
    require_command pnpm

    log "node $(node --version)"
    log "pnpm $(pnpm --version)"
}

run_smoke_checks() {
    log "checking local TypeScript, ESLint, and Vitest binaries"
    pnpm exec tsc --version >/dev/null
    pnpm exec eslint --version >/dev/null
    pnpm exec vitest --version >/dev/null
}

print_next_steps() {
    log "ready; use pnpm dev while iterating and pnpm check before review"
}

main() {
    cd "$(repo_root)"

    ensure_dependencies
    print_tool_versions
    run_smoke_checks
    warn_missing_env OPENAI_API_KEY
    print_next_steps
}

main "$@"
