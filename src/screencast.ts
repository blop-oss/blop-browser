import type { CDPSession, Page } from "playwright";

/** A single streamed frame of the page, JPEG-encoded by the browser. */
export type ScreencastFrame = {
  /** JPEG bytes for the frame. */
  data: Buffer;
  /** Wall-clock time the frame was received. */
  timestamp: number;
  /** Monotonic sequence number (1-based). */
  seq: number;
};

export type ScreencastOptions = {
  page: Page;
  /** JPEG quality 0-100. Lower = smaller/faster. */
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** Capture every Nth repaint. 1 = every frame. */
  everyNthFrame?: number;
  /** Called for each frame as it arrives, off the agent's critical path. */
  onFrame?: (frame: ScreencastFrame) => void;
};

export type Screencast = {
  /** Most recent frame, or null before the first repaint. */
  latest(): ScreencastFrame | null;
  /** Total frames received so far. */
  frameCount(): number;
  stop(): Promise<void>;
};

/**
 * Stream the page as a live JPEG screencast over the Chrome DevTools Protocol
 * instead of taking a blocking `page.screenshot()` after every action.
 *
 * The browser pushes a frame when the page repaints. The host can retain the
 * latest received view during navigation and between tool calls, then reuse
 * that in-memory frame without requesting a per-action screenshot.
 *
 * CDP screencast is Chromium-only; returns null for firefox/webkit or if the
 * CDP session cannot be established, so callers can fall back gracefully.
 */
export async function startScreencast(options: ScreencastOptions): Promise<Screencast | null> {
  const { page } = options;

  let client: CDPSession;
  try {
    client = await page.context().newCDPSession(page);
  } catch {
    // Non-chromium browser, or CDP unavailable: caller falls back to screenshots.
    return null;
  }

  let latest: ScreencastFrame | null = null;
  let count = 0;
  let stopped = false;

  client.on("Page.screencastFrame", (params: { data: string; sessionId: number }) => {
    // Ack immediately and unconditionally so the browser keeps streaming;
    // a missed ack stalls the whole screencast.
    client.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
    if (stopped) return;
    count += 1;
    const frame: ScreencastFrame = {
      data: Buffer.from(params.data, "base64"),
      timestamp: Date.now(),
      seq: count,
    };
    latest = frame;
    try {
      options.onFrame?.(frame);
    } catch {
      // A misbehaving sink must never break the stream.
    }
  });

  try {
    await client.send("Page.startScreencast", {
      format: "jpeg",
      quality: options.quality ?? 50,
      maxWidth: options.maxWidth ?? 1280,
      maxHeight: options.maxHeight ?? 800,
      everyNthFrame: options.everyNthFrame ?? 1,
    });
  } catch {
    try {
      await client.detach();
    } catch {
      // already gone
    }
    return null;
  }

  return {
    latest: () => latest,
    frameCount: () => count,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await client.send("Page.stopScreencast");
      } catch {
        // Page/session may already be closing.
      }
      try {
        await client.detach();
      } catch {
        // already detached
      }
    },
  };
}
