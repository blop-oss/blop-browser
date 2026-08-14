import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { BrowserSessionScope } from "../session/scope.js";

export type CliSessionPrivacySummary = {
  version: 1;
  mode: "local-managed" | "attached-cdp";
  telemetry: {
    firstPartyHarness: "off";
    destination: null;
  };
  recording: {
    actionTrace: "on";
    sessionMetrics: "on";
    screenshots: "on-demand";
    stepScreenshots: "off";
    screencast: "off";
  };
  retention: {
    localArtifacts: "until-destroy" | "until-close";
    managedBrowserStorage: "until-destroy" | "until-close" | "not-managed";
    externalBrowserStorage: "not-applicable" | "preserved";
    daemonLog: "until-destroy" | "until-close";
  };
  locations: {
    runtimeDirectory: string;
    profileDirectory: string | null;
    downloadsDirectory: string | null;
    artifactDirectory: string;
    daemonLog: string;
  };
  remoteControlEndpoint: string | null;
};

export function createCliSessionPrivacySummary(
  session: string,
  scope: BrowserSessionScope,
  cdpEndpoint?: string,
): CliSessionPrivacySummary {
  const runtimeDirectory = dirname(scope.artifactDirectory);
  const disposable = scope.mode === "disposable";
  return {
    version: 1,
    mode: cdpEndpoint ? "attached-cdp" : "local-managed",
    telemetry: {
      firstPartyHarness: "off",
      destination: null,
    },
    recording: {
      actionTrace: "on",
      sessionMetrics: "on",
      screenshots: "on-demand",
      stepScreenshots: "off",
      screencast: "off",
    },
    retention: {
      localArtifacts: disposable ? "until-close" : "until-destroy",
      managedBrowserStorage: cdpEndpoint
        ? "not-managed"
        : disposable
        ? "until-close"
        : "until-destroy",
      externalBrowserStorage: cdpEndpoint ? "preserved" : "not-applicable",
      daemonLog: disposable ? "until-close" : "until-destroy",
    },
    locations: {
      runtimeDirectory,
      profileDirectory: scope.profileDirectory,
      downloadsDirectory: scope.downloadsDirectory,
      artifactDirectory: scope.artifactDirectory,
      daemonLog: join(runtimeDirectory, `${session}.log`),
    },
    remoteControlEndpoint: cdpEndpoint
      ? displayCdpEndpoint(cdpEndpoint)
      : null,
  };
}

export function displayCdpEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  const port = url.port || (url.protocol === "http:" || url.protocol === "ws:"
    ? "80"
    : "443");
  return `${url.protocol}//${url.hostname}:${port}`;
}

export function identifyCdpEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}
