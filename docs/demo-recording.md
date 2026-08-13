# Record the Blop Browser launch demo

This guide produces an honest launch demo using a real authenticated test
account. The recording shows semantic refs, state persistence across separate
CLI commands, and the package's live Chromium screencast API. It doesn't supply
fake application data or a pre-rendered result.

## Prepare the environment

Use a non-production test account with data that is safe to publish. You need
Node.js 22 or newer, Blop Browser built locally or installed from npm, Chrome or
Chromium, a second browser for the screencast dashboard, and a desktop recorder
such as OBS Studio.

Set these values for the application and page state you will demonstrate:

```bash
export BLOP_DEMO_URL="https://your-test-app.example/dashboard"
export BLOP_DEMO_EXPECT_TEXT="Dashboard"
export BLOP_DEMO_CDP_ENDPOINT="http://127.0.0.1:9222"
```

Use exact public test data in the recording. Don't show passwords, one-time
codes, API keys, cookies, CDP WebSocket URLs, private customer names, or a real
personal profile.

Build the local package before recording from a checkout:

```bash
bun install --frozen-lockfile
bun run build
```

## Start an authenticated Chrome session

Launch Chrome with remote debugging restricted to localhost and a dedicated
demo profile. The profile persists the test account between rehearsal and the
final recording.

```bash
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/blop-browser-demo-profile \
  "$BLOP_DEMO_URL"
```

Before recording, sign in manually with the test account, navigate back to the
starting page, close unrelated tabs, dismiss password-manager prompts, and
clear any notifications that contain private data. Don't record the sign-in
secret entry.

Configure Blop Browser to attach to that Chrome instance:

```bash
blop-browser config \
  --mode chrome-cdp \
  --cdp-endpoint "$BLOP_DEMO_CDP_ENDPOINT"
blop-browser --session launch-demo doctor --json
```

The saved endpoint identifies Chrome but doesn't authorize access to its
profile. Include `--attach-existing` on the first command that starts the
Blop Browser attachment.

## Start the screencast dashboard

The included script attaches a second CDP client to the active application tab,
uses the exported `startScreencast()` API, and serves the latest in-memory JPEG
at `http://127.0.0.1:4173`. It doesn't write authenticated frames to disk.

```bash
BLOP_DEMO_PAGE_URL_CONTAINS="/dashboard" \
node scripts/demo-screencast.mjs
```

Open `http://127.0.0.1:4173` in a browser that isn't the debug-enabled Chrome
instance. Keep the terminal and dashboard visible side by side in a 1920×1080
recording canvas. The dashboard intentionally shows a waiting message until the
first browser repaint arrives.

## Record the interaction

Use this sequence for the final take. Rehearse once to identify a safe control
that navigates within the authenticated application, then reset the page before
recording.

1. Show the repository title and positioning in the README for about three
   seconds.
2. Show the authenticated application in the screencast dashboard without
   exposing login credentials.
3. In the terminal, navigate and take a semantic snapshot:

   ```bash
   blop-browser --session launch-demo --attach-existing \
     open "$BLOP_DEMO_URL"
   blop-browser --session launch-demo snapshot
   ```

4. Point out one semantic ref from the actual snapshot. Copy it exactly into an
   environment variable; don't hard-code a ref before the recording because
   refs are scoped to the current page state:

   ```bash
   export BLOP_DEMO_REF="e7"
   blop-browser --session launch-demo click "$BLOP_DEMO_REF"
   ```

5. Run a new process and prove that it sees the post-click authenticated state:

   ```bash
   blop-browser --session launch-demo status --json
   blop-browser --session launch-demo snapshot
   blop-browser --session launch-demo \
     expect-text "$BLOP_DEMO_EXPECT_TEXT"
   ```

6. Show that the screencast updated while the commands reused the same named
   session. Hold the result for two seconds.
7. Close only the Blop Browser connection after the final shot:

   ```bash
   blop-browser --session launch-demo close
   ```

If the chosen action changes the page enough to invalidate refs, take another
snapshot before the next interaction. A stale-ref error is correct behavior and
must not be edited out as if the old ref still worked.

## Review and publish the asset

Keep the final demo between 25 and 45 seconds, with legible terminal text and no
background music required. Use cuts only to remove idle setup time; don't splice
commands in a way that implies state or speed that wasn't observed.

Review the final export frame by frame for secrets and private application data.
Then place the approved files at these paths:

```text
docs/assets/demo/blop-browser-demo.mp4
docs/assets/demo/blop-browser-demo-poster.webp
```

Update the README only after both files exist in the repository. Use the poster
as a linked image rather than relying on GitHub to autoplay video.

## Next steps

After publishing the approved asset, upload the same reviewed poster as the
repository social preview and mark those items complete in
[`launch-checklist.md`](launch-checklist.md).
