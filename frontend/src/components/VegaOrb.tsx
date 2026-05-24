import React from 'react';

export type OrbMode = 'idle' | 'listening' | 'processing' | 'speaking';

interface VegaOrbProps {
  mode: OrbMode;
  onClick: () => void;
}

const MODE_LABELS: Record<OrbMode, string> = {
  idle: 'SAY VEGA',
  listening: 'LISTENING',
  processing: 'THINKING',
  speaking: 'SPEAKING',
};

const MODE_COLORS: Record<OrbMode, string> = {
  idle: '#00d4aa',
  listening: '#00ff88',
  processing: '#4da6ff',
  speaking: '#00d4aa',
};

const ORB_ANIMATIONS = `
  @keyframes vega-idle-pulse {
    0%, 100% { transform: scale(1); opacity: 0.55; box-shadow: 0 0 12px 2px rgba(0,212,170,0.25); }
    50% { transform: scale(1.06); opacity: 0.75; box-shadow: 0 0 22px 6px rgba(0,212,170,0.4); }
  }
  @keyframes vega-ring-expand {
    0% { transform: scale(1); opacity: 0.8; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  @keyframes vega-spin-arc {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  @keyframes vega-bar-1 {
    0%, 100% { height: 6px; } 50% { height: 22px; }
  }
  @keyframes vega-bar-2 {
    0%, 100% { height: 10px; } 50% { height: 28px; }
  }
  @keyframes vega-bar-3 {
    0%, 100% { height: 14px; } 50% { height: 32px; }
  }
  @keyframes vega-bar-4 {
    0%, 100% { height: 10px; } 50% { height: 26px; }
  }
  @keyframes vega-bar-5 {
    0%, 100% { height: 6px; } 50% { height: 20px; }
  }
  @keyframes vega-label-fade {
    0%, 100% { opacity: 0.7; } 50% { opacity: 1; }
  }
`;

export function VegaOrb({ mode, onClick }: VegaOrbProps) {
  const color = MODE_COLORS[mode];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <>
      <style>{ORB_ANIMATIONS}</style>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          userSelect: 'none',
        }}
      >
        {/* Orb container: fixed 80x80 bounding box */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`VEGA voice assistant — ${MODE_LABELS[mode]}`}
          onClick={onClick}
          onKeyDown={handleKeyDown}
          style={{
            width: 80,
            height: 80,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            outline: 'none',
            borderRadius: '50%',
          }}
        >
          {/* ── IDLE: slow gentle glow pulse ── */}
          {mode === 'idle' && (
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: `radial-gradient(circle at 35% 35%, ${color}cc, ${color}66)`,
                animation: 'vega-idle-pulse 3s ease-in-out infinite',
                border: `2px solid ${color}55`,
              }}
            />
          )}

          {/* ── LISTENING: bright core + 3 expanding rings ── */}
          {mode === 'listening' && (
            <>
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    border: `2px solid ${color}`,
                    animation: `vega-ring-expand 1.8s ${i * 0.6}s ease-out infinite`,
                    opacity: 0,
                  }}
                />
              ))}
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: `radial-gradient(circle at 35% 35%, ${color}, ${color}99)`,
                  boxShadow: `0 0 20px 6px ${color}66`,
                  position: 'relative',
                  zIndex: 1,
                }}
              />
            </>
          )}

          {/* ── PROCESSING: spinning arc ── */}
          {mode === 'processing' && (
            <>
              {/* Dim core */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${color}44, transparent)`,
                  position: 'absolute',
                }}
              />
              {/* Spinning arc ring */}
              <div
                style={{
                  width: 62,
                  height: 62,
                  borderRadius: '50%',
                  border: `3px solid transparent`,
                  borderTopColor: color,
                  borderRightColor: `${color}55`,
                  animation: 'vega-spin-arc 1s linear infinite',
                  position: 'absolute',
                }}
              />
              {/* Counter-rotating inner arc */}
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  border: `2px solid transparent`,
                  borderBottomColor: color,
                  borderLeftColor: `${color}44`,
                  animation: 'vega-spin-arc 0.7s linear infinite reverse',
                  position: 'absolute',
                }}
              />
            </>
          )}

          {/* ── SPEAKING: waveform bars ── */}
          {mode === 'speaking' && (
            <>
              {/* Core circle */}
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: `radial-gradient(circle at 35% 35%, ${color}bb, ${color}55)`,
                  boxShadow: `0 0 16px 4px ${color}44`,
                  position: 'absolute',
                }}
              />
              {/* 5 bars overlaid */}
              <div
                style={{
                  position: 'absolute',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  zIndex: 1,
                }}
              >
                {([
                  { anim: 'vega-bar-1', delay: '0s' },
                  { anim: 'vega-bar-2', delay: '0.15s' },
                  { anim: 'vega-bar-3', delay: '0.05s' },
                  { anim: 'vega-bar-4', delay: '0.25s' },
                  { anim: 'vega-bar-5', delay: '0.1s' },
                ] as const).map(({ anim, delay }, i) => (
                  <div
                    key={i}
                    style={{
                      width: 4,
                      height: 14,
                      borderRadius: 2,
                      background: '#0d1117',
                      animation: `${anim} 0.6s ${delay} ease-in-out infinite`,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Mode label */}
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.5,
            color,
            animation: mode !== 'idle' ? 'vega-label-fade 1.5s ease-in-out infinite' : undefined,
            opacity: mode === 'idle' ? 0.5 : 1,
            transition: 'color 0.3s',
          }}
        >
          {MODE_LABELS[mode]}
        </div>
      </div>
    </>
  );
}
