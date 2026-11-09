# Research — Face Blur Anonymizer

Ringkasan riset di balik proyek ini: bagaimana deteksi wajah Haar cascade
bekerja, parameter apa yang dipakai aplikasi ini dan kenapa, bagaimana blur
Gaussian menganonimkan wajah, dan apa batasnya dari sisi privasi.

## 1. Deteksi wajah: kerangka Viola–Jones

Aplikasi ini memakai detektor wajah klasik Viola–Jones (2001), bukan model
deep learning. Alasannya praktis: detektor ini ringan, tidak butuh GPU,
sudah tersedia sebagai build WebAssembly (OpenCV.js), dan cukup akurat
untuk foto frontal — syarat yang cocok untuk tool anonimisasi yang jalan
sepenuhnya di browser.

Tiga ide inti dari Viola & Jones (2004):

1. **Integral image** — setiap fitur Haar-like (selisih jumlah piksel dua
   persegi panjang) dapat dihitung dalam waktu konstan dari integral image,
   berapa pun ukuran fiturnya.
2. **AdaBoost untuk seleksi fitur** — dari ratusan ribu fitur kandidat,
   AdaBoost memilih beberapa ribu yang paling diskriminatif; detektor akhir
   Viola–Jones memakai 6.061 fitur dalam 38 stage.
3. **Attentional cascade** — stage awal yang murah menolak sebagian besar
   jendela non-wajah dengan cepat; hanya kandidat yang lolos semua stage
   yang dinyatakan wajah. Pada set uji MIT+CMU, rata-rata hanya 8 dari
   4.297 fitur yang dievaluasi per jendela.

Pada desktop Pentium III 700 MHz tahun 2001, sistem ini mendeteksi wajah
pada citra 384×288 dengan kecepatan 15 frame/detik, dengan tingkat deteksi
sekitar 95% dan false positive sekitar 1 dari 14.084 jendela.

## 2. Implementasi: Haar cascade OpenCV

OpenCV menyediakan file cascade yang sudah dilatih
(`haarcascade_frontalface_default.xml`, dilatih dengan fitur Haar) beserta
`CascadeClassifier::detectMultiScale`, yang membangun piramida skala dan
menerapkan cascade di tiap skala. Parameter yang dipakai aplikasi ini sama
dengan default tutorial OpenCV:

| Parameter | Nilai | Alasan |
| --- | --- | --- |
| `scaleFactor` | 1,1 | Tiap tingkat piramida 10% lebih kecil — kompromi standar antara menemukan wajah berbagai ukuran dan kecepatan |
| `minNeighbors` | 5 | Kandidat harus didukung 5 deteksi tetangga agar dipertahankan — menekan false positive |
| `minSize` | 30×30 px | Wajah lebih kecil dari itu diabaikan; di bawah ukuran ini hasil blur pun tidak lagi bermakna |
| Pra-pemrosesan | grayscale + `equalizeHist` | Cascade dilatih pada citra grayscale; ekualisasi histogram meratakan kontras foto gelap/terang |

File cascade yang dipakai adalah salinan persis dari repositori OpenCV
(`opencv/data/haarcascades/haarcascade_frontalface_default.xml`, cabang
4.9.0), disimpan di `assets/` agar aplikasi bekerja offline.

Perlu dicatat: OpenCV 5.0 memindahkan detektor Haar/HOG ke modul
`opencv_contrib` sebagai fitur deprecated — untuk proyek ini kami sengaja
tetap memakai OpenCV.js 4.9.0, versi stabil terakhir yang membawa cascade
sebagai fitur inti. Alternatif modern (mis. YuNet, sejak OpenCV 4.5.4)
lebih akurat tetapi butuh model DNN terpisah dan tidak sepadan untuk tool
sekecil ini.

## 3. Anonimisasi: blur Gaussian

Setelah wajah ditemukan, tiap kotak wajah diperluas dengan padding 10%
(agar dagu, dahi, dan telinga ikut tertutup) lalu di-blur dengan filter
Gaussian (`cv.GaussianBlur`). Ukuran kernel dihitung dari lebar wajah dan
kekuatan yang dipilih pengguna — rumusnya ada di `src/geometry.js`:

```
k = round(lebar_wajah × (0,05 + 0,4 × kekuatan))   # lalu dibulatkan ke ganjil, minimal 3
```

Pada kekuatan default 60% dan wajah selebar 208 px (sudah termasuk
padding), kernelnya 61 px — cukup besar untuk menghancurkan detail
identitas (mata, hidung, mulut) sambil menjaga konteks foto (pakaian,
latar) tetap terbaca. Blur Gaussian dipilih karena sederhana, deterministik,
dan tersedia di OpenCV.js; teknik yang lebih kuat (mis. pixelasi kasar
atau inpainting) berada di luar cakupan tool ini.

**Yang dijamin aplikasi ini:** piksel di luar kotak wajah tidak berubah
sama sekali (diverifikasi: mean abs diff luar = 0,0 — lihat
`examples/verification-report.json`).

## 4. Privasi: kenapa blur lokal di browser

Foto yang mengandung wajah adalah data pribadi. GDPR Recital 26
menyatakan prinsip perlindungan data tidak berlaku untuk informasi anonim —
yakni data yang "tidak berkaitan dengan orang yang teridentifikasi atau
dapat diidentifikasi", termasuk "data pribadi yang dibuat anonim sedemikian
rupa sehingga subjek data tidak atau tidak lagi dapat diidentifikasi".
Blur yang menghancurkan fitur wajah adalah salah satu cara mencapai itu,
dengan dua catatan kejujuran:

- **Blur bukan anonimisasi absolut.** Wajah yang di-blur ringan masih
  bisa dikenali dari konteks (pakaian, latar, orang di sebelahnya), dan
  teknik deblurring berbasis AI terus membaik. Tool ini memakai kernel
  besar secara default justru untuk menaikkan ambang itu, tetapi tidak
  ada klaim "tidak mungkin diidentifikasi".
- **Pemrosesan lokal itu penting.** Aplikasi ini tidak mengunggah apa pun:
  OpenCV.js dan cascade di-vendor ke dalam repo, dan semua komputasi
  berjalan di perangkat pengguna. Foto asli tidak pernah meninggalkan
  browser — yang diunduh hanya hasil blur-nya.

## 5. Hasil verifikasi (contoh nyata)

Contoh memakai `lena.jpg` (512×512, dari OpenCV samples — foto uji
klasik yang sudah menjadi standar de facto pemrosesan citra). Pipeline
yang sama persis dengan aplikasi browser (cascade, parameter, rumus
kernel, padding) dijalankan dengan OpenCV native; hasilnya:

| Ukuran | Nilai |
| --- | --- |
| Wajah terdeteksi | 1 — kotak (216, 202, 174×174) |
| Kotak setelah padding 10% | (199, 185, 208×208) |
| Kernel Gaussian (kekuatan 60%) | 61 px |
| Perubahan piksel rata-rata di dalam wajah | 19,13 (skala 0–255) |
| Perubahan piksel rata-rata di luar wajah | 0,0 |

Artefak: `examples/lena-blurred.png` (hasil blur) dan
`examples/verification-report.json` (angka lengkap). Detail metode dan
catatan kejujuran soal verifikasi browser ada di README.

## References

1. Paul Viola & Michael J. Jones. "Rapid Object Detection Using a Boosted
   Cascade of Simple Features." *Proc. IEEE CVPR 2001*.
   doi:10.1109/CVPR.2001.990517 —
   https://en.wikipedia.org/wiki/Viola%E2%80%93Jones_object_detection_framework
2. Paul Viola & Michael J. Jones. "Robust Real-Time Face Detection."
   *International Journal of Computer Vision* 57(2):137–154, 2004.
   doi:10.1023/B:VISI.0000013087.49260.fb —
   https://courses.cs.duke.edu/courses/spring05/cps296.1/handouts/Viola%20Jones%202004.pdf
3. OpenCV. "Cascade Classifier" tutorial (OpenCV 4.x) —
   https://ccoderun.ca/programming/doxygen/opencv_4/tutorial_cascade_classifier.html
4. OpenCV. "Face Detection using Haar Cascades", OpenCV-Python Tutorials —
   https://opencv24-python-tutorials.readthedocs.io/en/latest/py_tutorials/py_objdetect/py_face_detection/py_face_detection.html
5. OpenCV. "Cascade Classification", OpenCV 2.4.9 docs (dokumentasi
   `detectMultiScale`: scaleFactor, minNeighbors, minSize) —
   https://docs.opencv.org/2.4.9/modules/objdetect/doc/cascade_classification.html
6. OpenCV.js 4.9.0 (build resmi, di-vendor di `vendor/opencv.js`) —
   https://docs.opencv.org/4.9.0/opencv.js
7. Cascade `haarcascade_frontalface_default.xml` (OpenCV 4.9.0) —
   https://raw.githubusercontent.com/opencv/opencv/4.9.0/data/haarcascades/haarcascade_frontalface_default.xml
8. Foto uji `lena.jpg` (OpenCV samples) —
   https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg
9. GDPR Recital 26, "Not applicable to anonymous data" —
   https://gdpr.eu/Recital-26-Not-applicable-to-anonymous-data/
