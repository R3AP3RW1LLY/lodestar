import { describe, expect, it } from "vitest";
import { isOk } from "@lodestar/shared";
import {
  normalizeEdsmReserve,
  normalizeEdsmRingType,
  parseEdsmBodies,
  parseEdsmSystems,
} from "./parse.js";
import { EDSM_PAESIA_BODIES, EDSM_SPHERE_SYSTEMS } from "./fixtures.js";

describe("normalizers", () => {
  it.each([
    ["Metal Rich", "MetalRich"],
    ["Metallic", "Metallic"],
    ["Icy", "Icy"],
    ["Rocky", "Rocky"],
  ])("ring type %s → %s", (a, b) => {
    expect(normalizeEdsmRingType(a)).toBe(b);
  });

  it.each([
    ["Pristine", "Pristine"],
    ["PristineResources", "Pristine"],
    ["Depleted", "Depleted"],
  ])("reserve %s → %s", (a, b) => {
    expect(normalizeEdsmReserve(a)).toBe(b);
  });
});

describe("parseEdsmSystems", () => {
  it("parses recorded sphere-systems, skipping entries without coordinates", () => {
    const result = parseEdsmSystems(EDSM_SPHERE_SYSTEMS);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.map((s) => s.name)).toEqual(["Sol", "Sirius"]); // "Uncharted" dropped
    expect(result.value[1]).toEqual({
      name: "Sirius",
      coords: { x: 6.25, y: -1.28125, z: -5.75 },
      distanceLy: 8.59,
    });
  });

  it("rejects a non-array payload", () => {
    const result = parseEdsmSystems({ error: "nope" });
    expect(isOk(result)).toBe(false);
  });

  it("rejects a system entry with no name", () => {
    const result = parseEdsmSystems([{ coords: { x: 0, y: 0, z: 0 } }]);
    expect(isOk(result)).toBe(false);
  });
});

describe("parseEdsmBodies", () => {
  it("parses recorded bodies, normalizing ring type and carrying reserve; drops ringless bodies data intact", () => {
    const result = parseEdsmBodies(EDSM_PAESIA_BODIES);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.systemName).toBe("Paesia");
    const paesia2 = result.value.bodies.find((b) => b.name === "Paesia 2");
    expect(paesia2).toMatchObject({
      bodyType: "Planet",
      reserve: "Pristine",
      rings: [{ name: "Paesia 2 A Ring", ringType: "Metallic" }],
    });
    const paesia5 = result.value.bodies.find((b) => b.name === "Paesia 5");
    expect(paesia5?.rings[0]?.ringType).toBe("MetalRich"); // "Metal Rich" normalized
    const star = result.value.bodies.find((b) => b.name === "Paesia A");
    expect(star?.rings).toEqual([]); // a star with no rings parses with an empty ring list
  });

  it("rejects a payload with no system name", () => {
    expect(isOk(parseEdsmBodies({ bodies: [] }))).toBe(false);
  });

  it("tolerates a missing bodies array (empty result)", () => {
    const result = parseEdsmBodies({ name: "Empty" });
    expect(isOk(result) && result.value.bodies).toEqual([]);
  });

  it("drops malformed rings and a body carrying neither type nor reserve", () => {
    const result = parseEdsmBodies({
      name: "Odd",
      bodies: [{ name: "Odd 1", rings: [{ name: "no-type-ring" }, { type: "Icy" }, 42] }],
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const body = result.value.bodies[0];
    expect(body).toMatchObject({ name: "Odd 1", rings: [] }); // all three ring entries invalid
    expect(body?.bodyType).toBeUndefined();
    expect(body?.reserve).toBeUndefined();
  });
});
