import { describe, expect, it } from "vitest";
import { installOverlayBridge } from "./overlay.js";
import { OVERLAY_WS_PORT_FLAG, OVERLAY_WS_TOKEN_FLAG } from "../overlay-connection.js";

describe("installOverlayBridge", () => {
  it("exposes exactly one key — 'lodestarOverlay' — with the parsed connection (and no ipcRenderer)", () => {
    const calls: [string, unknown][] = [];
    installOverlayBridge({ exposeInMainWorld: (k, v) => calls.push([k, v]) }, [
      `${OVERLAY_WS_PORT_FLAG}7000`,
      `${OVERLAY_WS_TOKEN_FLAG}tok`,
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("lodestarOverlay");
    expect(calls[0]?.[1]).toEqual({ port: 7000, token: "tok" });
  });

  it("exposes null when no connection info is present in argv", () => {
    const calls: [string, unknown][] = [];
    installOverlayBridge({ exposeInMainWorld: (k, v) => calls.push([k, v]) }, ["electron.exe"]);
    expect(calls[0]?.[1]).toBeNull();
  });
});
