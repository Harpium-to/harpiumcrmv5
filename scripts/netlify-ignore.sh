#!/usr/bin/env bash
# ============================================================
# Netlify "ignore" command for the CRM site (netlify.toml).
#
# Every production deploy costs 15 Netlify credits, and on 2026-11-27
# the credits ran out and the CRM went offline. A commit that only
# touches what the app never builds from does not need a deploy:
#   docs/        plans and guides
#   LP/          the landing page, which has its own Netlify site
#   supabase/    migrations (applied by hand) and database tests
#   *.md         READMEs, AGENTS.md, CHANGELOG
#
# Exit 0 skips the build (Netlify cancels it, free); exit 1 builds.
# When in doubt it builds: a skipped deploy that was needed is worse
# than a deploy that wasn't.
# ============================================================
set -u

prev="${CACHED_COMMIT_REF:-}"
curr="${COMMIT_REF:-}"

# First build, or a manual "Trigger deploy" of the same commit: build.
if [ -z "$prev" ] || [ -z "$curr" ] || [ "$prev" = "$curr" ]; then
  exit 1
fi

# The previous commit is not in this clone, so the change can't be
# measured: build.
git cat-file -e "${prev}^{commit}" 2>/dev/null || exit 1

if git diff --quiet "$prev" "$curr" -- . \
  ':(exclude)docs' \
  ':(exclude)LP' \
  ':(exclude)supabase' \
  ':(exclude)*.md'; then
  echo "netlify-ignore: só docs/, LP/, supabase/ ou .md mudaram desde $prev — build pulado."
  exit 0
fi
exit 1
