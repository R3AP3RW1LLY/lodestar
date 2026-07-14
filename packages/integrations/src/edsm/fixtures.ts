/**
 * Recorded-shape EDSM response fixtures (SSOT Step 4.7 — test doubles for an external
 * service are allowed per the operator policy). Hand-authored to match EDSM's public
 * `sphere-systems` and `bodies` payloads; consumed only by the EDSM tests.
 */

/** EDSM `GET /api-v1/sphere-systems?...&showCoordinates=1`. Third entry omits coords. */
export const EDSM_SPHERE_SYSTEMS: unknown = [
  { name: "Sol", coords: { x: 0, y: 0, z: 0 }, distance: 0 },
  { name: "Sirius", coords: { x: 6.25, y: -1.28125, z: -5.75 }, distance: 8.59 },
  { name: "Uncharted", distance: 12.3 },
];

/** EDSM `GET /api-system-v1/bodies?systemName=Paesia`. */
export const EDSM_PAESIA_BODIES: unknown = {
  id: 4149,
  name: "Paesia",
  bodies: [
    {
      name: "Paesia 2",
      type: "Planet",
      subType: "High metal content world",
      reserveLevel: "Pristine",
      rings: [
        { name: "Paesia 2 A Ring", type: "Metallic", innerRadius: 74670, outerRadius: 140900 },
      ],
    },
    {
      name: "Paesia 5",
      type: "Planet",
      reserveLevel: "Major",
      rings: [{ name: "Paesia 5 A Ring", type: "Metal Rich" }],
    },
    { name: "Paesia A", type: "Star" },
  ],
};
