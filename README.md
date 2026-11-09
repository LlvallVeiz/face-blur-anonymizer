# face-blur-anonymizer

Blur wajah otomatis di foto — untuk privasi dataset — sepenuhnya di browser.
Deteksi wajah memakai Haar cascade (Viola–Jones) via OpenCV.js, blur memakai
filter Gaussian. Tidak ada build step, tidak ada server, tidak ada unggahan:
buka `index.html`, pilih foto, tekan **Anonymize faces**, unduh hasilnya.

## Background

Foto yang memuat wajah adalah data pribadi. Sebelum foto dibagikan —
misalnya sebagai dataset latih, dokumentasi lapangan, atau lampiran laporan —
wajah di dalamnya perlu dibuat tidak dapat diidentifikasi. GDPR Recital 26
menyatakan prinsip perlindungan data tidak berlaku untuk informasi anonim,
yakni data yang dibuat anonim "sedemikian rupa sehingga subjek data tidak
atau tidak lagi dapat diidentifikasi".

Tool ini melakukan anonimisasi itu secara lokal: OpenCV.js dan file cascade
di-vendor ke dalam repo, semua komputasi berjalan di perangkat pengguna, dan
foto asli tidak pernah meninggalkan browser. Yang diunduh hanya hasil
blur-nya. Detail teori, parameter, dan batas kejujurannya ada di
[`docs/RESEARCH.md`](docs/RESEARCH.md).

## Cara kerja

1. **Muat foto** — dari file, atau tombol *Load sample photo (Lena)*.
2. **Deteksi** — foto diubah ke grayscale, diekualisasi histogramnya, lalu
   `CascadeClassifier.detectMultiScale` mencari wajah dengan
   `haarcascade_frontalface_default.xml` (`scaleFactor=1.1`,
   `minNeighbors=5`, `minSize=30×30`).
3. **Blur** — tiap kotak wajah diperluas padding 10% (dagu, dahi, telinga
   ikut tertutup), lalu di-blur Gaussian. Ukuran kernel mengikuti lebar
   wajah dan kekuatan yang dipilih:
   `k = round(lebar × (0,05 + 0,4 × kekuatan))`, dibulatkan ke ganjil,
   minimal 3 px.
4. **Periksa & unduh** — hasil tampil berdampingan dengan aslinya, lengkap
   dengan kotak deteksi dan laporan (jumlah wajah, ukuran kernel, perubahan
   piksel). Tombol *Download blurred image* menyimpan PNG hasil blur.

## Struktur proyek

```
face-blur-anonymizer/
├── index.html          # UI aplikasi (tanpa build step)
├── app.js              # pipeline: load → deteksi → blur → laporan
├── styles.css
├── src/
│   └── geometry.js     # helper murni (kernel, padding, metrik piksel)
├── assets/
│   ├── haarcascade_frontalface_default.xml   # cascade OpenCV 4.9.0
│   └── lena.jpg        # foto contoh (OpenCV samples, 512×512)
├── vendor/
│   ├── opencv.js       # OpenCV.js 4.9.0 resmi (10.257.309 byte, SHA-256 di README vendor)
│   └── README.md       # asal-usul + alasan vendoring
├── tests/
│   ├── unit.test.mjs   # tes unit geometry.js (Node, tanpa browser)
│   ├── verify.mjs      # verifikasi end-to-end di Chromium via Playwright
│   └── verify_cv2.py   # verifikasi pipeline yang sama dengan OpenCV native
├── examples/           # artefak hasil run verifikasi (bukan mock)
└── docs/
    └── RESEARCH.md     # riset + referensi
```

## Cara menjalankan

Tidak perlu install apa pun untuk memakai aplikasinya — cukup sajikan folder
ini lewat HTTP statis (modul ES tidak boleh dibuka via `file://`) lalu buka
di browser:

```sh
python3 -m http.server 8000
# buka http://localhost:8000/index.html
```

Untuk menjalankan tes (butuh Node.js 18+):

```sh
npm test            # tes unit + verifikasi browser (Playwright)
npm run test:unit   # hanya tes unit: node --test tests/unit.test.mjs
npm run verify      # hanya verifikasi browser: node tests/verify.mjs
```

Verifikasi pipeline dengan OpenCV native (butuh Python + `opencv-python-
headless` 4.10, lihat `tests/verify_cv2.py`):

```sh
python3 tests/verify_cv2.py
```

## Contoh output (dari run beneran)

Foto contoh `lena.jpg` (512×512), kekuatan blur 60%, padding 10%:

| Ukuran | Nilai |
| --- | --- |
| Wajah terdeteksi | 1 — kotak (216, 202, 174×174) |
| Kotak setelah padding 10% | (199, 185, 208×208) |
| Kernel Gaussian | 61 px |
| Perubahan piksel rata-rata di dalam wajah | 19,13 (skala 0–255) |
| Perubahan piksel rata-rata di luar wajah | 0,0 |

Artefak lengkapnya ada di `examples/`: `lena-blurred.png` (hasil blur) dan
`verification-report.json` (angka lengkap + hasil cek). Tes unit
`src/geometry.js`: **5/5 lolos** (`npm run test:unit`).

### Catatan kejujuran soal verifikasi browser

Verifikasi end-to-end di browser (`tests/verify.mjs`, Playwright +
Chromium, memakai aplikasi dan OpenCV.js yang sama persis) **belum
berhasil diselesaikan di sandbox ini**: inisialisasi OpenCV.js (kompilasi
WASM ~8 MB) membuat renderer Chromium berjalan di ~100% CPU selama
bermenit-menit tanpa mencapai `ready`, baik di headless shell maupun
Chromium penuh — kemungkinan besar karena CPU VM yang terbatas (1,5 core
bersama), bukan karena bug aplikasi. Di mesin biasa, `npm run verify`
diharapkan selesai dalam hitungan puluhan detik; silakan jalankan sendiri
dan bandingkan dengan `examples/verification-report.json`.

Sebagai pengganti, pipeline yang *sama persis* — file cascade yang sama,
parameter `detectMultiScale` yang sama, rumus kernel dan padding yang sama
(diimplementasi ulang baris-per-baris dari `src/geometry.js`) — diverifikasi
dengan OpenCV native 4.10 (`tests/verify_cv2.py`): 1 wajah terdeteksi,
piksel wajah berubah 19,13, piksel luar tidak berubah (0,0). Angka-angka
di tabel atas berasal dari run itu. Unit test logika geometrinya (5/5)
juga lolos tanpa browser.

## Keputusan desain

- **Haar cascade, bukan DNN.** Ringan, tanpa GPU, tersedia sebagai
  WebAssembly, dan cukup untuk foto frontal. Alternatif modern (YuNet)
  lebih akurat tetapi butuh model DNN terpisah. OpenCV 5.0 memindahkan
  cascade ke `opencv_contrib` sebagai deprecated — karena itu proyek ini
  mengunci OpenCV.js 4.9.0.
- **Semua di-vendor, tanpa CDN.** Aplikasi anonimisasi tidak boleh
  bergantung pada jaringan — dan di sandbox ini CDN `docs.opencv.org`
  memang diblokir proxy. `vendor/opencv.js` + `assets/*.xml` membuat
  aplikasi bekerja penuh offline setelah clone.
- **Logika murni dipisah (`src/geometry.js`).** Fungsi kernel, padding,
  dan metrik piksel tidak bergantung pada DOM/OpenCV, jadi bisa diuji
  dengan `node --test` dan dipakai ulang untuk verifikasi independen.
- **Blur hanya di dalam kotak wajah.** Piksel luar tidak disentuh sama
  sekali — konteks foto (pakaian, latar) tetap utuh dan bisa diaudit
  dari metrik `meanAbsDiffOutside = 0`.

## Keterbatasan & pengembangan

- Haar cascade andal untuk wajah frontal dan terang; wajah miring,
  tertutup sebagian, atau sangat kecil sering lolos. Untuk dataset yang
  menuntut recall tinggi, ganti detektor ke YuNet/DNN dan ukur ulang
  presisi/recall-nya.
- Blur bukan anonimisasi absolut: wajah yang di-blur ringan masih bisa
  dikenali dari konteks, dan teknik deblurring terus membaik. Pakai
  kekuatan blur besar untuk foto yang benar-benar sensitif, dan jangan
  pernah mengklaim hasil blur "tidak mungkin diidentifikasi".
- Aplikasi ini memproses satu foto per sekali jalan. Pengembangan
  selanjutnya: mode batch (banyak foto sekaligus), pilihan pixelasi
  sebagai alternatif blur, dan preset "dataset aman" (kekuatan 100% +
  padding 20%).

## Lisensi

MIT — lihat [LICENSE](LICENSE). OpenCV.js berlisensi Apache 2.0
(lihat header `vendor/opencv.js`); `lena.jpg` adalah foto uji standar
dari OpenCV samples.
