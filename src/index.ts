import "./session/bun-ws-compat.js";

export type {
  TestStatus,
  HarnessAction,
  BrowserContentBoundary,
  CallerContentBoundary,
  HarnessContentBoundary,
  MixedContentBoundary,
  ToolContentBoundary,
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
  NativeModelImageInput,
  NativeToolResult,
  BrowserToolContext,
  BrowserActionCategory,
  BrowserApprovalDecision,
  BrowserApprovalPolicy,
  BrowserApprovalRequest,
  BrowserSafetyPolicy,
} from "./tools/types.js";

export { BrowserSafetyError, BrowserToolError } from "./tools/safety.js";

export { startScreencast, type Screencast, type ScreencastFrame, type ScreencastOptions } from "./screencast.js";

export {
  createTraceRecorder,
  BROWSER_TRACE_COMMAND_KINDS,
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
  type BrowserTraceCommandKind,
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

export {
  browserSessionDirectories,
  defaultBrowserRuntimeDirectory,
  getBrowserSessionScope,
  validateBrowserSessionName,
  type BrowserProfileMode,
  type BrowserSessionDirectories,
  type BrowserSessionScope,
} from "./session/scope.js";

export { locateTarget, locateAllTargets, selectorFor, type BrowserTarget, targetParameterSchema } from "./tools/locators.js";
