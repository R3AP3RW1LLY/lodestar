import { describe, expect, it } from "vitest";
import {
  OVERLAY_WS_PORT_FLAG,
  OVERLAY_WS_TOKEN_FLAG,
  parseOverlayConnection,
} from "./overlay-connection.js";

describe("parseOverlayConnection", () => {
  it("extracts the port + token from argv", () => {
    const conn = parseOverlayConnection([
      "electron.exe",
      "app",
      `${OVERLAY_WS_PORT_FLAG}4321`,
      `${OVERLAY_WS_TOKEN_FLAG}abc123`,
    ]);
    expect(conn).toEqual({ port: 4321, token: "abc123" });
  });

  it("returns undefined when the port is missing, non-numeric, or non-positive", () => {
    expect(parseOverlayConnection([`${OVERLAY_WS_TOKEN_FLAG}abc`])).toBeUndefined();
    expect(
      parseOverlayConnection([`${OVERLAY_WS_PORT_FLAG}nope`, `${OVERLAY_WS_TOKEN_FLAG}abc`]),
    ).toBeUndefined();
    expect(
      parseOverlayConnection([`${OVERLAY_WS_PORT_FLAG}0`, `${OVERLAY_WS_TOKEN_FLAG}abc`]),
    ).toBeUndefined();
  });

  it("returns undefined when the token is missing or empty", () => {
    expect(parseOverlayConnection([`${OVERLAY_WS_PORT_FLAG}4321`])).toBeUndefined();
    expect(
      parseOverlayConnection([`${OVERLAY_WS_PORT_FLAG}4321`, OVERLAY_WS_TOKEN_FLAG]),
    ).toBeUndefined();
  });
});
