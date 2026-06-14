#!/usr/bin/env bash

set -euo pipefail

log() {
    printf '[devcontainer:on-create] %s\n' "$*"
}

repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

require_command() {
    local command_name="$1"

    if ! command -v "${command_name}" >/dev/null 2>&1; then
        printf '[devcontainer:on-create] Missing required command: %s\n' "${command_name}" >&2
        exit 1
    fi
}

ensure_writable_volume() {
    local path="$1"

    mkdir -p "${path}"

    if [[ -w "${path}" ]]; then
        return
    fi

    require_command sudo
    log "fixing ownership for ${path}"
    sudo chown -R "$(id -u):$(id -g)" "${path}"
}

enable_corepack() {
    require_command node
    require_command corepack

    log "enabling Corepack"
    corepack enable
}

configure_pnpm() {
    require_command pnpm

    local store_dir="${PNPM_STORE_PATH:-.pnpm-store}"
    ensure_writable_volume "${store_dir}"
    ensure_writable_volume "node_modules"

    log "configuring pnpm store: ${store_dir}"
    pnpm config set store-dir "${store_dir}"

    if [[ -n "${NPM_REGISTRY:-}" ]]; then
        log "configuring npm registry: ${NPM_REGISTRY}"
        pnpm config set registry "${NPM_REGISTRY}"
    fi
}

install_dependencies() {
    log "installing dependencies"
    pnpm install --frozen-lockfile
}

main() {
    cd "$(repo_root)"

    enable_corepack
    configure_pnpm
    install_dependencies
}

main "$@"
