import { useRef, useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import CameraSection from './components/CameraSection';
import InfoPanel from './components/InfoPanel';
import { useAppState } from './hooks/useAppState';
import { useTheme } from './hooks/useTheme';
import { DetectionService } from './services/DetectionService';
import { CameraService } from './services/CameraService';
import { RootFactsService } from './services/RootFactsService';
import { APP_CONFIG, isValidDetection } from './utils/config';
import { createDelay, logError, getCameraErrorMessage } from './utils/common';
import { requestPersistentStorage } from './utils/storage';

const MODEL_READY = 'Model AI Siap';
const MODEL_FAILED = 'Model gagal dimuat';
// Cadence inferensi ~4x/detik (bukan tiap frame) demi performa & hemat baterai.
const INFERENCE_INTERVAL = 250;

function App() {
  const { state, actions } = useAppState();
  const { theme, cycleTheme } = useTheme();

  const detectionLoopRef = useRef(null);
  const isBusyRef = useRef(false); // cegah tumpang tindih saat menganalisis satu hasil
  const fpsSamplesRef = useRef([]);
  const aiLoadRef = useRef(null); // promise pemuatan model Generative AI

  const [currentTone, setCurrentTone] = useState('normal');
  const [backend, setBackend] = useState(null);
  const [liveFps, setLiveFps] = useState(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [aiProgress, setAiProgress] = useState(0); // progres unduhan model Generative AI
  const [aiReady, setAiReady] = useState(false);

  const stopDetectionLoop = useCallback(() => {
    if (detectionLoopRef.current) {
      clearInterval(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    fpsSamplesRef.current = [];
    // Angka FPS terakhir sengaja dipertahankan agar tetap terbaca setelah
    // deteksi berhenti (di-reset ke 0 hanya saat kamera dimatikan).
  }, []);

  /**
   * Muat kedua model. Dipisah agar bisa dipanggil ulang saat pemuatan gagal
   * (mis. di perangkat mobile yang cache-nya sempat terusir browser).
   */
  const loadModels = useCallback(
    async ({ detector, generator }, isCancelled = () => false) => {
      try {
        actions.setError(null);
        // Model deteksi menggerbangi tombol scan.
        await detector.loadModel((p) => {
          if (!isCancelled()) actions.setModelStatus(`Memuat Model AI... ${p}%`);
        });
        if (isCancelled()) return;
        setBackend(detector.backend);
        actions.setModelStatus(MODEL_READY);

        // Model Generative AI dimuat di latar belakang (tidak memblokir deteksi).
        // Promise-nya disimpan agar proses fun fact bisa menunggunya bila belum selesai.
        aiLoadRef.current = generator
          .loadModel((p) => {
            if (!isCancelled()) setAiProgress(p);
          })
          .then((res) => {
            if (!isCancelled()) setAiReady(true);
            return res;
          })
          .catch((error) => {
            logError('Model AI gagal dimuat', error);
            return null;
          });
      } catch (error) {
        if (isCancelled()) return;
        logError('Inisialisasi model gagal', error);
        actions.setModelStatus(MODEL_FAILED);
        actions.setError('Model failed to load.');
      }
    },
    [actions],
  );

  // ---- [Basic] Inisialisasi layanan & muat model saat aplikasi dimuat ----
  useEffect(() => {
    let cancelled = false;
    const detector = new DetectionService();
    const camera = new CameraService();
    const generator = new RootFactsService();
    actions.setServices({ detector, camera, generator });

    // Minta penyimpanan persisten lebih dulu agar cache model tidak diusir
    // browser saat kuota menipis (krusial untuk offline di perangkat mobile).
    requestPersistentStorage().finally(() => {
      if (!cancelled) loadModels({ detector, generator }, () => cancelled);
    });

    // ---- [Basic] Bersihkan sumber daya saat komponen ditinggalkan ----
    return () => {
      cancelled = true;
      stopDetectionLoop();
      camera.stopCamera();
      detector.dispose();
    };
  }, []);

  // Coba muat ulang model setelah gagal (dipicu dari tombol scan).
  const retryLoadModels = useCallback(() => {
    const { detector, generator } = state.services;
    if (!detector || !generator) return;
    actions.setModelStatus('Memuat Model AI... 0%');
    loadModels({ detector, generator });
  }, [state.services, actions, loadModels]);

  // Pantau status online/offline untuk indikator PWA.
  useEffect(() => {
    const online = () => setIsOffline(false);
    const offline = () => setIsOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // ---- Proses satu hasil deteksi valid: analisis -> hasil -> fun fact ----
  const handleValidDetection = useCallback(
    async (result, generator) => {
      actions.setDetectionResult(result);
      actions.setFunFactData(null);
      actions.setAppState('analyzing');

      // Jeda singkat agar transisi UI terasa halus.
      await createDelay(APP_CONFIG.analyzingDelay);
      actions.setAppState('result');

      // Model AI mungkin masih diunduh saat deteksi selesai — tunggu dulu
      // (spinner "Memuat fakta menarik..." tetap tampil) daripada langsung gagal.
      if (!generator.isReady() && aiLoadRef.current) {
        await aiLoadRef.current;
      }

      // Generative AI: hasilkan fun fact bila model siap (jika tidak -> tampilkan error).
      if (generator.isReady()) {
        try {
          generator.setTone(currentTone);
          const fact = await generator.generateFacts(result.className);
          actions.setFunFactData(fact || 'error');
        } catch (error) {
          logError('Generasi fun fact gagal', error);
          actions.setFunFactData('error');
        }
      } else {
        actions.setFunFactData('error');
      }
    },
    [actions, currentTone],
  );

  // ---- [Basic] Loop deteksi (throttled) ----
  const startDetectionLoop = useCallback(
    (services) => {
      const { detector, camera, generator } = services;
      stopDetectionLoop();
      isBusyRef.current = false;

      detectionLoopRef.current = setInterval(async () => {
        if (isBusyRef.current) return;
        if (!camera.isReady() || !detector.isLoaded()) return;

        const frame = camera.captureFrame();
        if (!frame) return;

        const start = performance.now();
        isBusyRef.current = true;
        try {
          const result = await detector.predict(frame);

          // Hitung FPS inferensi aktual (rata-rata bergerak).
          const dt = performance.now() - start;
          const samples = fpsSamplesRef.current;
          samples.push(1000 / dt);
          if (samples.length > 10) samples.shift();
          setLiveFps(Math.round(samples.reduce((a, b) => a + b, 0) / samples.length));

          if (isValidDetection(result)) {
            stopDetectionLoop();
            await handleValidDetection(result, generator);
          }
        } catch (error) {
          logError('Prediksi gagal', error);
        } finally {
          isBusyRef.current = false;
        }
      }, INFERENCE_INTERVAL);
    },
    [stopDetectionLoop, handleValidDetection],
  );

  // ---- [Basic] Mulai / hentikan kamera ----
  const handleToggleCamera = useCallback(async () => {
    const { camera, detector } = state.services;
    if (!camera) return;

    // Model gagal dimuat (mis. cache terusir di mobile) -> jadikan tombol sebagai retry.
    if (detector && !detector.isLoaded()) {
      retryLoadModels();
      return;
    }

    if (state.isRunning) {
      stopDetectionLoop();
      camera.stopCamera();
      setLiveFps(0);
      actions.setRunning(false);
      actions.resetResults();
      return;
    }

    try {
      actions.setError(null);
      actions.resetResults();
      await camera.startCamera();
      actions.setRunning(true);
      startDetectionLoop(state.services);
    } catch (error) {
      logError('Kamera gagal dimulai', error);
      actions.setError(error.message || getCameraErrorMessage(error));
      actions.setRunning(false);
    }
  }, [
    state.services,
    state.isRunning,
    actions,
    startDetectionLoop,
    stopDetectionLoop,
    retryLoadModels,
  ]);

  // ---- [Advance] Ubah tone fakta ----
  const handleToneChange = useCallback(
    (tone) => {
      setCurrentTone(tone);
      state.services.generator?.setTone(tone);
    },
    [state.services],
  );

  // ---- [Skilled] Salin fun fact ke clipboard ----
  const handleCopyFact = useCallback(async () => {
    const fact = state.funFactData;
    if (!fact || fact === 'error') return;
    try {
      await navigator.clipboard.writeText(fact);
    } catch (error) {
      logError('Gagal menyalin ke clipboard', error);
    }
  }, [state.funFactData]);

  return (
    <div className="app-container">
      <Header
        modelStatus={state.modelStatus}
        backend={backend}
        isOffline={isOffline}
        aiProgress={aiProgress}
        aiReady={aiReady}
        theme={theme}
        onCycleTheme={cycleTheme}
      />

      <main className="main-content">
        <CameraSection
          isRunning={state.isRunning}
          onToggleCamera={handleToggleCamera}
          onToneChange={handleToneChange}
          services={state.services}
          modelStatus={state.modelStatus}
          error={state.error}
          currentTone={currentTone}
          liveFps={liveFps}
        />

        <InfoPanel
          appState={state.appState}
          detectionResult={state.detectionResult}
          funFactData={state.funFactData}
          error={state.error}
          onCopyFact={handleCopyFact}
        />
      </main>

      <footer className="footer">
        <p>Powered by TensorFlow.js &amp; Transformers.js</p>
      </footer>

      {state.error && (
        <div className="error-toast">
          <strong>Error:</strong> {state.error}
          <button
            className="error-toast__close"
            onClick={() => actions.setError(null)}
            aria-label="Tutup pesan error"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
