import { Sprout, Sun, Moon, Monitor, Cpu, WifiOff, Sparkles } from 'lucide-react';

const THEME_ICON = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_LABEL = {
  light: 'Tema terang',
  dark: 'Tema gelap',
  system: 'Ikuti sistem',
};

function Header({
  modelStatus,
  backend,
  isOffline,
  aiProgress = 0,
  aiReady = false,
  theme = 'system',
  onCycleTheme,
}) {
  const isModelReady = modelStatus === 'Model AI Siap';
  const ThemeIcon = THEME_ICON[theme] || Monitor;

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <Sprout size={20} />
          <span>RootFacts</span>
        </div>

        <div className="header-actions">
          {isOffline && (
            <span className="badge badge--offline" title="Mode offline">
              <WifiOff size={12} />
              <span>Offline</span>
            </span>
          )}

          {backend && (
            <span className="badge badge--backend" title="Backend TensorFlow.js">
              <Cpu size={12} />
              <span>{backend.toUpperCase()}</span>
            </span>
          )}

          {!aiReady && (
            <span className="badge badge--ai" title="Progres unduhan model Generative AI">
              <Sparkles size={12} />
              <span>AI {aiProgress}%</span>
            </span>
          )}

          <span className="status-pill">
            <span className={`status-dot ${isModelReady ? 'active' : ''}`}></span>
            <span>{modelStatus}</span>
          </span>

          <button
            type="button"
            className="theme-toggle"
            onClick={onCycleTheme}
            title={THEME_LABEL[theme]}
            aria-label={THEME_LABEL[theme]}
          >
            <ThemeIcon size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;
