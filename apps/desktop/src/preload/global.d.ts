import type { LodestarApi } from "./api.js";

declare global {
  interface Window {
    readonly lodestar: LodestarApi;
  }
}

export {};
