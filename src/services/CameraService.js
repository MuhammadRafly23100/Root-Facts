import { getCameraErrorMessage, logError } from '../utils/common.js';

/**
 * CameraService — mengelola akses kamera (getUserMedia), menampilkan preview
 * pada elemen <video>, dan menangkap frame ke <canvas> untuk diproses model.
 */
export class CameraService {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.config = null;
    this.cameras = [];
    this.selectedCameraId = null;
    this.facingMode = 'environment';
    this.fps = 30;
  }

  setVideoElement(videoElement) {
    this.video = videoElement;
  }

  setCanvasElement(canvasElement) {
    this.canvas = canvasElement;
  }

  // [Basic] Ambil daftar perangkat input video yang tersedia.
  async loadCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameras = devices.filter((d) => d.kind === 'videoinput');
    } catch (error) {
      logError('Gagal memuat daftar kamera', error);
      this.cameras = [];
    }
    return this.cameras;
  }

  // [Basic] Susun constraints berdasarkan kamera yang dipilih / facingMode.
  _getConstraints(selectedCameraId) {
    const video = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: this.fps },
    };

    if (selectedCameraId) {
      video.deviceId = { exact: selectedCameraId };
    } else {
      video.facingMode = this.facingMode;
    }

    return { video, audio: false };
  }

  // [Basic] Mulai kamera & tampilkan pada elemen video.
  async startCamera(selectedCameraId) {
    if (!this.video) throw new Error('Elemen video belum tersedia');

    // Hentikan stream lama sebelum memulai yang baru (mis. saat ganti kamera).
    this.stopCamera();

    this.selectedCameraId = selectedCameraId ?? this.selectedCameraId;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(
        this._getConstraints(this.selectedCameraId),
      );
    } catch (error) {
      // Fallback: coba tanpa constraint spesifik bila deviceId/facingMode gagal.
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (fallbackError) {
        throw new Error(getCameraErrorMessage(fallbackError));
      }
    }

    this.video.srcObject = this.stream;
    await this.video.play();

    // Setelah izin diberikan, label perangkat baru bisa dibaca -> refresh daftar.
    if (this.cameras.length === 0) {
      await this.loadCameras();
    }

    return this.stream;
  }

  // [Basic] Hentikan stream & bersihkan sumber daya.
  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  /**
   * Tangkap frame video saat ini ke canvas dan kembalikan elemen canvas.
   * Canvas dipakai sebagai input model agar ukuran konsisten & stabil di semua backend.
   */
  captureFrame() {
    if (!this.isReady() || !this.canvas) return null;

    const { videoWidth, videoHeight } = this.video;
    if (this.canvas.width !== videoWidth) this.canvas.width = videoWidth;
    if (this.canvas.height !== videoHeight) this.canvas.height = videoHeight;

    const ctx = this.canvas.getContext('2d');
    ctx.drawImage(this.video, 0, 0, videoWidth, videoHeight);
    return this.canvas;
  }

  // [Skilled] Atur target FPS kamera.
  setFPS(fps) {
    this.fps = Number(fps) || 30;
    const track = this.stream?.getVideoTracks?.()[0];
    if (track && track.applyConstraints) {
      track.applyConstraints({ frameRate: { ideal: this.fps } }).catch(() => {});
    }
    return this.fps;
  }

  getFPS() {
    return this.fps;
  }

  // [Basic] Apakah kamera sedang aktif?
  isActive() {
    return this.stream !== null && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  // [Basic] Apakah elemen video siap dipakai?
  isReady() {
    return (
      this.video !== null &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0
    );
  }
}
