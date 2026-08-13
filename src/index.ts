import "./session/bun-ws-compat.js";

export type {
  TestStatus,
  HarnessAction,
  HarnessScreenshot,
  HarnessCriticalPoint,
  HarnessBrowserLog,
} from "./types.js";

export {
  createBrowserTools,
  type FinishState,
  type NativeToolBridge,
} from "./create-tools.js";

export type {
  NativeModelImage,
  NativeToolResult,
  BrowserToolContext,
} from "./tools/types.js";

export { startScreencast, type Screencast, type ScreencastFrame, type ScreencastOptions } from "./screencast.js";

export {
  createTraceRecorder,
  formatTraceTimeline,
  isStateChangingCommand,
  redactTraceInput,
  redactTraceUrl,
  type HarnessTraceEvent,
  type HarnessTraceExport,
  type TraceApproval,
  type TraceIdentity,
  type TraceMediaPosition,
  type TraceRecorder,
  type TraceRecorderOptions,
  type TraceRecordContext,
} from "./trace-recorder.js";

export {
  ensurePlaywrightContainer,
  startPlaywrightContainer,
  stopPlaywrightContainer,
  _resetEgressCacheForTests,
  type PlaywrightContainerOptions,
  type PlaywrightContainerSession,
} from "./session/playwright-container.js";

export {
  ensureCamoufoxContainer,
  startCamoufoxContainer,
  stopCamoufoxContainer,
  type CamoufoxContainerOptions,
  type CamoufoxContainerSession,
} from "./session/camoufox-container.js";

export { locateTarget, locateAllTargets, selectorFor, type BrowserTarget, targetParameterSchema } from "./tools/locators.js";
