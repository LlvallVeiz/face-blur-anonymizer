/**
 * face-blur-anonymizer — pure geometry / pixel helpers.
 *
 * These functions are deliberately free of any DOM or OpenCV dependency so
 * they can be unit-tested in plain Node.js (see tests/unit.test.mjs) and
 * reused by the browser app (app.js).
 */

/**
 * Gaussian-blur kernel size (in pixels) for a detected face.
 *
 * The kernel must be odd and at least 3 (an OpenCV requirement for
 * GaussianBlur). It scales with the face width so that a small face in a
 * large photo gets the same *relative* anonymisation as a large face, and
 * with the user-chosen strength (0 = weakest, 1 = strongest).
 *
 * @param {number} faceWidth  width of the detected face rectangle, px
 * @param {number} strength   0..1
 * @returns {number} odd kernel size, >= 3
 */
export function blurKernelSize(faceWidth, strength) {
  const s = Math.min(1, Math.max(0, strength));
  const w = Math.max(1, faceWidth);
  // Kernel spans 5% of the face width at strength 0 up to 45% at strength 1.
  let k = Math.round(w * (0.05 + 0.4 * s));
  if (k < 3) k = 3;
  if (k % 2 === 0) k += 1; // kernels must be odd
  return k;
}

/**
 * Clamp a rectangle to the image bounds.
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function clampRect(rect, imgWidth, imgHeight) {
  const x = Math.max(0, Math.min(rect.x, imgWidth));
  const y = Math.max(0, Math.min(rect.y, imgHeight));
  const x2 = Math.max(x, Math.min(rect.x + rect.width, imgWidth));
  const y2 = Math.max(y, Math.min(rect.y + rect.height, imgHeight));
  return { x, y, width: x2 - x, height: y2 - y };
}

/**
 * Expand a face rectangle by `padding` (fraction of the face size, e.g.
 * 0.1 = 10% on every side) so the blur also covers chin, forehead and
 * ears, then clamp it to the image bounds.
 *
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} padding  0..1 (values are clamped to that range)
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function padRect(rect, padding, imgWidth, imgHeight) {
  const p = Math.min(1, Math.max(0, padding));
  const padX = Math.round(rect.width * p);
  const padY = Math.round(rect.height * p);
  return clampRect(
    {
      x: rect.x - padX,
      y: rect.y - padY,
      width: rect.width + 2 * padX,
      height: rect.height + 2 * padY,
    },
    imgWidth,
    imgHeight,
  );
}

/**
 * Mean absolute per-channel difference between two RGBA images inside a
 * rectangle (used to prove the blur actually changed the face region).
 *
 * @param {Uint8ClampedArray} a  RGBA pixels of image A
 * @param {Uint8ClampedArray} b  RGBA pixels of image B (same dimensions)
 * @param {number} width          image width in pixels
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @returns {number} mean |a - b| over R, G, B inside the rectangle (0..255)
 */
export function meanAbsDiffInRect(a, b, width, rect) {
  let sum = 0;
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const i = (y * width + x) * 4;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Mean absolute per-channel difference between two RGBA images *outside*
 * a list of rectangles (used to prove the blur left the rest alone).
 *
 * @param {Uint8ClampedArray} a
 * @param {Uint8ClampedArray} b
 * @param {number} width
 * @param {number} height
 * @param {Array<{x:number,y:number,width:number,height:number}>} rects
 * @returns {number} mean |a - b| over R, G, B outside all rectangles
 */
export function meanAbsDiffOutsideRects(a, b, width, height, rects) {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = false;
      for (const r of rects) {
        if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      const i = (y * width + x) * 4;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  }
  return n === 0 ? 0 : sum / n;
}
