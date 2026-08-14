# Record the Blop Browser launch demo

This guide produces an authorized launch demo against a bundled local fixture.
The recording shows semantic refs, state persistence across separate CLI
commands, and the package's live Chromium screencast API without using a live
website or authenticated account.

Follow the [acceptable-use policy](../ACCEPTABLE_USE.md) for every recording.
Review [privacy and data flows](../PRIVACY.md) before exposing page pixels,
semantic text, URLs, or retained artifacts in a recording.
Don't substitute a production account, third-party service, CAPTCHA, access
denial, purchase, or other consequential workflow in launch material.

## Prepare the environment

You need Node.js 22 or newer, Blop Browser built locally or installed from npm,
Chrome or Chromium, a second browser for the screencast dashboard, and a desktop
recorder such as OBS Studio.

From the repository root, set the local fixture URL and expected state:

```bash
export BLOP_DEMO_URL="file://$PWD/docs/assets/demo/authorized-fixture.html"
export BLOP_DEMO_EXPECT_TEXT="Review complete"
export BLOP_DEMO_CDP_ENDPOINT="http://127.0.0.1:9222"
```

Build the local package before recording from a checkout:

```bash
bun install --frozen-lockfile
bun run build
```

## Start a dedicated Chrome session

Launch Chrome with remote debugging restricted to localhost and a temporary,
dedicated profile. The profile must not contain cookies, saved passwords,
extensions, or accounts from everyday browsing.

```bash
export BLOP_DEMO_PROFILE="$(mktemp -d)"
google-chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$BLOP_DEMO_PROFILE" \
  "$BLOP_DEMO_URL"
```

Keep only the fixture tab open. Configure Blop Browser to attach to that Chrome
instance:

```bash
blop-browser config \
  --mode chrome-cdp \
  --cdp-endpoint "$BLOP_DEMO_CDP_ENDPOINT"
blop-browser --session launch-demo doctor --json
```

The saved endpoint identifies Chrome but doesn't authorize access to its
profile. Include `--attach-existing` on the first command that starts the
Blop Browser attachment. CDP grants broad control of the attached profile. Keep
the endpoint on `127.0.0.1`, use only the dedicated profile, and stop if another
page or profile is attached. CDP doesn't grant permission to automate an
external website.

## Start the screencast dashboard

The included script attaches a second CDP client to the fixture tab, uses the
exported `startScreencast()` API, and serves the latest in-memory JPEG at
`http://127.0.0.1:4173`. It doesn't write frames to disk.

```bash
BLOP_DEMO_PAGE_URL_CONTAINS="authorized-fixture.html" \
node scripts/demo-screencast.mjs
```

Open `http://127.0.0.1:4173` in a browser that isn't the debug-enabled Chrome
instance. Keep the terminal and dashboard visible side by side in a 1920x1080
recording canvas. The dashboard shows a waiting message until the first browser
repaint arrives.

## Record the interaction

Use this sequence for the final take. Reset the fixture before recording so its
button reads **Mark reviewed** and its status reads **Review pending**.

1. Show the repository title and positioning in the README for about three
   seconds.
2. Show the local fixture URL in the screencast dashboard.
3. In the terminal, navigate and take a semantic snapshot:

   ```bash
   blop-browser --session launch-demo --attach-existing \
     open "$BLOP_DEMO_URL"
   blop-browser --session launch-demo snapshot
   ```

4. Copy the **Mark reviewed** button's ref exactly from the current snapshot.
   Set it as an environment variable, and click it:

   ```bash
   export BLOP_DEMO_REF="e1"
   blop-browser --session launch-demo click "$BLOP_DEMO_REF"
   ```

   The example ref is illustrative. Don't use it unless the current snapshot
   assigns that exact ref to the button.

5. Run a new process and prove that it sees the post-click fixture state:

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

If an action invalidates refs, take another snapshot before the next
interaction. A stale-ref error is correct behavior and must not be edited out as
if the old ref still worked.

## Review and publish the asset

Keep the final demo between 25 and 45 seconds, with legible terminal text and no
background music required. Use cuts only to remove idle setup time; don't splice
commands in a way that implies state or speed that wasn't observed.

Confirm every browser frame shows only the bundled fixture and local dashboard.
Review the terminal for tokens, cookies, CDP WebSocket URLs, private paths, or
unrelated notifications. Then place the approved files at these paths:

```text
docs/assets/demo/blop-browser-demo.mp4
docs/assets/demo/blop-browser-demo-poster.webp
```

Update the README only after both files exist in the repository. Use the poster
as a linked image instead of relying on GitHub to autoplay video. Close Chrome,
then delete the temporary profile through your file manager after confirming
its path.

## Next steps

After publishing the approved asset, upload the same reviewed poster as the
repository social preview and mark those items complete in
[`launch-checklist.md`](launch-checklist.md).
