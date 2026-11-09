#!/usr/bin/env python3
"""Independent verification of the face-blur pipeline with native OpenCV.

Mirrors the browser app's pipeline exactly (see app.js):
  - grayscale + histogram equalisation
  - Haar cascade detectMultiScale(scaleFactor=1.1, minNeighbors=5,
    minSize=30x30) with haarcascade_frontalface_default.xml from assets/
  - Gaussian blur inside each face rect padded by 10%, kernel from the
    same rule as src/geometry.js: k = odd( w * (0.05 + 0.4*strength) ),
    minimum 3; strength 0.6 here (the app's default)
  - metrics: mean abs diff inside padded rects vs outside them

Writes examples/lena-blurred.png and examples/verification-report.json.
Run from the project root: /tmp/cvtest/bin/python tests/verify_cv2.py
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CASCADE = ROOT / "assets" / "haarcascade_frontalface_default.xml"
LENA = ROOT / "assets" / "lena.jpg"
OUT_PNG = ROOT / "examples" / "lena-blurred.png"
OUT_JSON = ROOT / "examples" / "verification-report.json"

STRENGTH = 0.6   # app default (slider 60%)
PADDING = 0.10   # app default (slider 10%)


def blur_kernel_size(face_width, strength):
    # Mirror src/geometry.js exactly: Math.round (half up), min 3, force odd.
    import math
    s = min(1.0, max(0.0, strength))
    w = max(1, face_width)
    k = math.floor(w * (0.05 + 0.4 * s) + 0.5)
    if k < 3:
        k = 3
    if k % 2 == 0:
        k += 1
    return k


def pad_rect(x, y, w, h, padding, img_w, img_h):
    px = int(round(w * padding))
    py = int(round(h * padding))
    x0 = max(0, x - px)
    y0 = max(0, y - py)
    x1 = min(img_w, x + w + px)
    y1 = min(img_h, y + h + py)
    return (x0, y0, x1 - x0, y1 - y0)


def mean_abs_diff(a, b, rect=None):
    if rect is None:
        d = np.abs(a.astype(np.int16) - b.astype(np.int16))
        return float(d.mean())
    x, y, w, h = rect
    d = np.abs(a[y:y + h, x:x + w].astype(np.int16)
               - b[y:y + h, x:x + w].astype(np.int16))
    return float(d.mean())


def main():
    img = cv2.imread(str(LENA))
    assert img is not None, f"cannot read {LENA}"
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    clf = cv2.CascadeClassifier(str(CASCADE))
    assert not clf.empty(), f"cannot load cascade {CASCADE}"
    faces = clf.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5,
                                 minSize=(30, 30))
    faces = [tuple(map(int, f)) for f in faces]
    print(f"image: {w}x{h}, faces detected: {len(faces)}")
    for f in faces:
        print("  face rect (x,y,w,h):", f)

    out = img.copy()
    padded, kernels = [], []
    for (x, y, fw, fh) in faces:
        r = pad_rect(x, y, fw, fh, PADDING, w, h)
        k = blur_kernel_size(r[2], STRENGTH)
        padded.append(r)
        kernels.append(k)
        roi = out[r[1]:r[1] + r[3], r[0]:r[0] + r[2]]
        out[r[1]:r[1] + r[3], r[0]:r[0] + r[2]] = cv2.GaussianBlur(
            roi, (k, k), 0)
    print("padded rects:", padded)
    print("kernel sizes:", kernels)

    inside = [round(mean_abs_diff(img, out, r), 2) for r in padded]
    inside_avg = round(sum(inside) / len(inside), 2) if inside else 0.0
    # Outside: compare on a mask that excludes all padded rects.
    mask = np.ones((h, w), dtype=bool)
    for (x, y, fw, fh) in padded:
        mask[y:y + fh, x:x + fw] = False
    d = np.abs(img.astype(np.int16) - out.astype(np.int16))
    outside = round(float(d[mask].mean()), 4) if mask.any() else 0.0
    print("mean abs diff inside (per face):", inside, "avg:", inside_avg)
    print("mean abs diff outside:", outside)

    OUT_PNG.parent.mkdir(exist_ok=True)
    cv2.imwrite(str(OUT_PNG), out)
    report = {
        "method": f"native OpenCV (cv2 {cv2.__version__}) — same cascade file, "
                  "same parameters as the browser app (app.js)",
        "sampleImage": "assets/lena.jpg (512x512, from opencv/opencv samples/data/lena.jpg)",
        "imageSize": [w, h],
        "facesDetected": len(faces),
        "faces": [{"x": x, "y": y, "width": fw, "height": fh}
                  for (x, y, fw, fh) in faces],
        "paddedFaces": [{"x": x, "y": y, "width": fw, "height": fh}
                        for (x, y, fw, fh) in padded],
        "blurStrength": STRENGTH,
        "padding": PADDING,
        "kernelSizes": kernels,
        "meanAbsDiffInside": inside,
        "meanAbsDiffInsideAvg": inside_avg,
        "meanAbsDiffOutside": outside,
        "checks": {
            "faceDetected": len(faces) >= 1,
            "facePixelsChanged": inside_avg > 5,
            "outsidePixelsUnchanged": outside == 0,
        },
    }
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    failed = [k for k, v in report["checks"].items() if v is not True]
    if failed:
        print("FAILED CHECKS:", ", ".join(failed))
        sys.exit(1)
    print("All verification checks passed.")


if __name__ == "__main__":
    main()
