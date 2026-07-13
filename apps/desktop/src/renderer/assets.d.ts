/** Vite resolves static asset imports to their URL string (Step 1.10 brand logo). */
declare module "*.svg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
