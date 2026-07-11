#!/usr/bin/env bash
# Preflight check for running the Bessel autonomous build on macOS.
# Usage: bash scripts/check-mac-setup.sh
# Exit 0 when all required items pass; iOS items are reported but optional
# (without full Xcode the run proceeds in web plus desktop mode).
set -u

pass=0; fail=0; warn=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }
note() { echo "OPT   $1"; warn=$((warn+1)); }

echo "Bessel macOS preflight"
echo "----------------------"

# Required: Command Line Tools (git, compilers for native node modules)
if xcode-select -p > /dev/null 2>&1; then
  ok "Xcode Command Line Tools present ($(xcode-select -p))"
else
  bad "Command Line Tools missing. Run: xcode-select --install"
fi

# Required: Node 22
if command -v node > /dev/null 2>&1; then
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    ok "Node $(node --version) (need 22+)"
  else
    bad "Node $(node --version) too old. Install 22: nvm install 22, or brew install node@22"
  fi
else
  bad "Node missing. Install 22: nvm install 22, or brew install node@22"
fi

# Required: pnpm 9+
if command -v pnpm > /dev/null 2>&1; then
  PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
  if [ "$PNPM_MAJOR" -ge 9 ] 2>/dev/null; then
    ok "pnpm $(pnpm --version) (need 9+)"
  else
    bad "pnpm $(pnpm --version) too old. Run: corepack enable && corepack prepare pnpm@latest --activate"
  fi
else
  bad "pnpm missing. Run: corepack enable && corepack prepare pnpm@latest --activate"
fi

# Required: git
if command -v git > /dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  bad "git missing (comes with the Command Line Tools)"
fi

# Required: Claude Code 2.1.139+ (the /goal command)
if command -v claude > /dev/null 2>&1; then
  CC_VER=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [ -n "${CC_VER}" ] && [ "$(printf '%s\n' "2.1.139" "$CC_VER" | sort -V | head -1)" = "2.1.139" ]; then
    ok "Claude Code $CC_VER (>= 2.1.139 for /goal)"
    if [ "$(printf '%s\n' "2.1.154" "$CC_VER" | sort -V | head -1)" = "2.1.154" ]; then
      ok "Claude Code $CC_VER (>= 2.1.154 for dynamic workflows)"
    else
      note "Claude Code $CC_VER runs /goal; 2.1.154+ adds dynamic workflows. Run: npm update -g @anthropic-ai/claude-code"
    fi
  else
    bad "Claude Code ${CC_VER:-unknown} too old. Run: npm update -g @anthropic-ai/claude-code"
  fi
else
  bad "Claude Code missing. Run: npm install -g @anthropic-ai/claude-code"
fi

# Required: network reachability for the run
for host in registry.npmjs.org naif.jpl.nasa.gov github.com; do
  if curl -sI --max-time 8 "https://$host" > /dev/null 2>&1; then
    ok "network: $host reachable"
  else
    bad "network: $host unreachable (kernels, packages, or sources will fail)"
  fi
done

# Optional: full Xcode plus CocoaPods (iOS sync; without them the run is web plus desktop)
if xcodebuild -version > /dev/null 2>&1; then
  ok "Xcode $(xcodebuild -version | head -1 | awk '{print $2}') (iOS sync available)"
  if command -v pod > /dev/null 2>&1; then
    ok "CocoaPods $(pod --version)"
  else
    note "CocoaPods missing for iOS sync. Run: brew install cocoapods"
  fi
else
  note "Full Xcode not installed: run proceeds web plus desktop only (cap:sync dropped). To add iOS later: install Xcode from the App Store, then sudo xcode-select -s /Applications/Xcode.app/Contents/Developer; sudo xcodebuild -license accept; xcodebuild -runFirstLaunch; brew install cocoapods"
fi

# Optional: Emscripten (only if CSPICE-WASM must be built from source)
if command -v emcc > /dev/null 2>&1; then
  ok "emscripten $(emcc --version | head -1 | grep -oE '[0-9.]+' | head -1) (WASM build de-risked)"
else
  note "emscripten not installed; fine if a prebuilt CSPICE-WASM is used. De-risk with: brew install emscripten"
fi

# Optional: tmux for the long unattended session
if command -v tmux > /dev/null 2>&1; then
  ok "tmux $(tmux -V | awk '{print $2}')"
else
  note "tmux recommended for the hours-long run. Run: brew install tmux"
fi

echo "----------------------"
echo "Summary: $pass pass, $fail fail, $warn optional"
if [ "$fail" -gt 0 ]; then
  echo "Resolve FAIL items before /implement."
  exit 1
fi
echo "Required items satisfied. OPT items only affect iOS sync, WASM build de-risking, or session comfort."
exit 0
