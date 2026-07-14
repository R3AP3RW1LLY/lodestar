/**
 * WebGL capability probe (SSOT Step 4.14). The 3D ring map renders only when the OS gives
 * Electron a hardware-accelerated GL context; otherwise the app degrades to the labelled
 * 2D ring schematic — a real fallback, never a blank canvas or a crash. Injectable so the
 * fallback path is testable headlessly (jsdom has no WebGL).
 */

export function hasWebGL(create: () => WebGLRenderingContext | null = defaultProbe): boolean {
  try {
    return create() !== null;
  } catch {
    return false;
  }
}

function defaultProbe(): WebGLRenderingContext | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
  return gl instanceof WebGLRenderingContext ? gl : null;
}
