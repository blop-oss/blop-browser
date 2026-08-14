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
  BrowserDomainPolicy,
  BrowserNavigationPhase,
  BrowserPolicyDecision,
  BrowserApprovalDecision,
  BrowserApprovalPolicy,
  BrowserApprovalRequest,
  BrowserSafetyPolicy,
  BrowserSessionPolicy,
} from "./tools/types.js";

export {
  BROWSER_TOOL_POLICY_CLASSES,
  BrowserSafetyError,
  BrowserToolError,
  browserDomainAllowed,
  validateBrowserSessionPolicy,
  type BrowserToolPolicyClass,
} from "./tools/safety.js";

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
  type TracePolicyDecision,
  type TraceIdentity,
  type TraceMediaPosition,
  type TraceRecorder,
  type TraceRecorderOptions,
  type TraceRecordContext,
  type BrowserTraceCommandKind,
} from "./trace-recorder.js";

export {
  createSessionMetricsRecorder,
  emptySessionMetrics,
  MAX_SESSION_METRICS_BYTES,
  validateSessionMetrics,
  type HarnessSessionMetrics,
  type SessionCommandMetrics,
  type SessionMetricApprovals,
  type SessionMetricDuration,
  type SessionMetricModelImages,
  type SessionMetricVolume,
  type SessionMetricsActionOptions,
  type SessionMetricsRecorder,
  type SessionMetricsRecorderOptions,
} from "./session-metrics.js";

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
  resolveInternetEgressProbe,
  type InternetEgressProbeDisclosure,
} from "./session/egress.js";

export {
  browserSessionDirectories,
  defaultBrowserRuntimeDirectory,
  getBrowserSessionScope,
  validateBrowserSessionName,
  type BrowserProfileMode,
  type BrowserSessionDirectories,
  type BrowserSessionScope,
} from "./session/scope.js";

export {
  BrowserControlError,
  createBrowserControlSession,
  type BrowserControlSession,
  type BrowserControlSessionOptions,
  type BrowserControlState,
  type BrowserControlStatus,
  type BrowserControlTransition,
  type BrowserHumanControlLease,
  type BrowserTakeoverOutcome,
  type BrowserTakeoverReason,
} from "./session/control.js";

export { locateTarget, locateAllTargets, selectorFor, type BrowserTarget, targetParameterSchema } from "./tools/locators.js";
