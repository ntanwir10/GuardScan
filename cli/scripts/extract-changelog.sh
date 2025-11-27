#!/bin/bash
# Extract changelog entry for a specific version from CHANGELOG.md
# Usage: ./extract-changelog.sh <version>
# Example: ./extract-changelog.sh 1.0.4

set -e

VERSION="${1:-}"
CHANGELOG_FILE="${2:-CHANGELOG.md}"

if [ -z "$VERSION" ]; then
  echo "Error: Version argument required" >&2
  echo "Usage: $0 <version> [changelog-file]" >&2
  exit 1
fi

if [ ! -f "$CHANGELOG_FILE" ]; then
  echo "Error: $CHANGELOG_FILE not found" >&2
  exit 1
fi

# Extract the changelog section for this version
# Look for pattern: ## [VERSION] - DATE
# Extract until next version section or end of file
awk -v version="$VERSION" '
  BEGIN { in_section = 0; found = 0 }
  /^## \[/ {
    if (in_section) exit
    if ($0 ~ "\\[" version "\\]") {
      in_section = 1
      found = 1
      print
      next
    }
  }
  in_section {
    if (/^## \[/) exit
    print
  }
  END {
    if (!found) {
      print "## Changelog entry not found for version " version > "/dev/stderr"
      exit 1
    }
  }
' "$CHANGELOG_FILE"

