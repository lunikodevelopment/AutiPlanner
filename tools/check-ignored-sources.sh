#!/usr/bin/env bash
#
# Fails if a source file is excluded by .gitignore.
#
# An unanchored `data/` rule once hid apps/android/.../data/ from the
# repository, so the published Android app could not compile from a fresh
# clone. Git only warns when a *tracked* file becomes ignored; a new source file
# inside an ignored directory disappears with no warning at all.
#
# Build output and dependencies are expected to be ignored, so they are
# excluded from this check.
set -euo pipefail

SOURCE_PATTERN='\.(kt|kts|java|py|ts|tsx|js|jsx|md|json|ya?ml|xml|ics|sql)$'
ARTIFACT_PATTERN='(^|/)(node_modules|build|dist|coverage|__pycache__|\.gradle|\.pytest_cache|\.pnpm-store|\.idea|\.vscode|venv|\.venv)/'

offenders="$(
  git ls-files --others --ignored --exclude-standard \
    | grep -E "$SOURCE_PATTERN" \
    | grep -vE "$ARTIFACT_PATTERN" \
    || true
)"

if [ -n "$offenders" ]; then
  echo "ERROR: these source files are excluded by .gitignore and would not be published:"
  echo "$offenders" | sed 's/^/  /'
  echo
  echo "Anchor the matching rule to the repository root (for example '/data/'),"
  echo "or add a negation for the path."
  exit 1
fi

echo "OK: no source files are gitignored."
