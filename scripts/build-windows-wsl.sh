#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Optional local LLVM/cargo-xwin/SDK environment. No tools are installed here.
if [[ -n "${LELE_TOOLCHAIN:-}" && -f "$LELE_TOOLCHAIN/env.sh" ]]; then
  source "$LELE_TOOLCHAIN/env.sh"
  if [[ -d "$LELE_TOOLCHAIN/llvm20-root/usr/lib/llvm-20/bin" ]]; then
    export PATH="$LELE_TOOLCHAIN/llvm20-root/usr/lib/llvm-20/bin:$PATH"
    export LD_LIBRARY_PATH="$LELE_TOOLCHAIN/llvm20-root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
  fi
fi
command -v cargo-xwin >/dev/null || { printf 'cargo-xwin is required. See README.md.\n' >&2; exit 1; }
command -v clang-cl >/dev/null || { printf 'clang-cl (19 or newer) is required.\n' >&2; exit 1; }
npm ci
npm run build
cargo xwin build -p leitor-lele --target x86_64-pc-windows-msvc --release --features custom-protocol
mkdir -p artifacts
cp target/x86_64-pc-windows-msvc/release/leitor-lele.exe artifacts/LeitorLele.exe
cp crates/comic-core/UNRAR-LICENSE.txt artifacts/UNRAR-LICENSE.txt
printf 'Windows executable: %s/artifacts/LeitorLele.exe\n' "$PWD"
