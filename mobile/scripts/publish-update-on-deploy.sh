#!/bin/sh
# Runs at the end of every Vercel build. On a production deploy it also publishes the app's
# JavaScript as an EAS Update (channel "production"), so installed iPhones/Android phones pick
# it up the next time the app opens or comes back to the foreground.
#
# Needs EXPO_TOKEN in the Vercel project's Production env (expo.dev → Account settings → Access tokens).
# Only JavaScript changes travel this way; new native modules or a new app version need a new build.

if [ "$VERCEL_ENV" != "production" ]; then
  echo "Mobile update: skipped (not a production deploy)."
  exit 0
fi
if [ -z "$EXPO_TOKEN" ]; then
  echo "Mobile update: skipped — add EXPO_TOKEN to the Vercel Production environment to publish phone updates."
  exit 0
fi

message="${VERCEL_GIT_COMMIT_MESSAGE:-Vercel deploy $(date -u +%Y-%m-%dT%H:%MZ)}"
# Vercel CLI deploys have no .git folder.
export EAS_NO_VCS=1

# A failed phone update must not block the server/web deploy, but it must be visible in the log.
if npx --yes eas-cli@latest update --channel production --environment production --non-interactive --message "$message"; then
  echo "Mobile update: published to channel production."
else
  echo "Mobile update: FAILED — the server and web app were deployed, phones were not updated. Run: cd mobile && npm run publish-update -- \"...\""
fi
