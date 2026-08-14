import { describe, expect, test } from "bun:test";
import {
  createContainerIdentityCache,
  resolveInternetEgressProbe,
} from "../../src/session/egress.js";

describe("container egress disclosure", () => {
  test("does not contact the public diagnostic endpoint by default", () => {
    expect(resolveInternetEgressProbe()).toEqual({
      enabled: false,
      destination: null,
    });
  });

  test("discloses the fixed endpoint when the diagnostic is explicitly enabled", () => {
    expect(resolveInternetEgressProbe(true)).toEqual({
      enabled: true,
      destination: "https://1.1.1.1:443",
    });
  });

  test("reuses a probe only for the same actual container identity", async () => {
    const cache = createContainerIdentityCache<boolean>();
    let probes = 0;
    const probe = async () => ++probes % 2 === 1;

    expect(await cache.getOrCreate("browser", "container-a", probe)).toBe(true);
    expect(await cache.getOrCreate("browser", "container-a", probe)).toBe(true);
    expect(probes).toBe(1);

    expect(await cache.getOrCreate("browser", "container-b", probe)).toBe(false);
    expect(probes).toBe(2);
  });
});
