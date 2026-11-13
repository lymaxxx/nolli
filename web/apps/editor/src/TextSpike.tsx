import { placeOnPath, shapeLine, type LoadedFont, type Point } from '@nolli/core';
import { useEffect, useRef, useState } from 'react';
import { fillPlacedText } from './drawText';
import { loadSpikeFonts } from './fonts';

const ROAD_WIDTH = 26;

/** Three sample roads, as fractions of the canvas, each a gentle curve. */
function sampleRoads(width: number, height: number): Point[][] {
  const curve = (y: number, bulge: number, phase: number): Point[] => {
    const points: Point[] = [];
    for (let step = 0; step <= 60; step++) {
      const t = step / 60;
      points.push({
        x: width * (0.06 + 0.88 * t),
        y: height * (y + bulge * Math.sin(Math.PI * (t * 1.5 + phase))),
      });
    }
    return points;
  };
  return [curve(0.22, 0.09, 0), curve(0.52, -0.08, 0.2), curve(0.8, 0.07, 0.5)];
}

export function TextSpike() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fonts, setFonts] = useState<LoadedFont[]>();
  const [error, setError] = useState<string>();
  const [texts, setTexts] = useState(['Devonshire Arcade', 'شارع الملك عبد العزيز', 'Souq سوق Road']);
  const [fontSize, setFontSize] = useState(22);
  const [tracking, setTracking] = useState(0);
  const [showFrames, setShowFrames] = useState(false);

  useEffect(() => {
    loadSpikeFonts().then(setFonts, (reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fonts) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext('2d')!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = '#f3efe6';
      context.fillRect(0, 0, width, height);

      sampleRoads(width, height).forEach((road, index) => {
        context.beginPath();
        road.forEach((point, i) => (i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.strokeStyle = '#ffffff';
        context.lineWidth = ROAD_WIDTH;
        context.stroke();

        const line = shapeLine(texts[index] ?? '', fonts, { tracking: tracking / 1000 });
        // Sit the text's middle height on the road's centre line.
        const placed = placeOnPath(line, road, { fontSize, baselineShift: -fontSize * 0.36 });

        if (showFrames) {
          context.strokeStyle = '#2563eb';
          context.lineWidth = 1;
          for (const unit of placed.units) {
            context.save();
            context.translate(unit.origin.x, unit.origin.y);
            context.rotate(unit.angle);
            context.beginPath();
            context.moveTo(0, -fontSize * 0.8);
            context.lineTo(0, fontSize * 0.25);
            context.stroke();
            context.restore();
          }
        }
        context.fillStyle = '#333333';
        fillPlacedText(context, placed.units, fonts, fontSize);
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [fonts, texts, fontSize, tracking, showFrames]);

  if (error) return <p className="status" role="alert">{error}</p>;
  if (!fonts) return <p className="status">Loading fonts…</p>;

  return (
    <main className="spike">
      <form onSubmit={(event) => event.preventDefault()}>
        {texts.map((text, index) => (
          <label key={index}>
            Road {index + 1}
            <input
              type="text"
              dir="auto"
              value={text}
              onChange={(event) =>
                setTexts(texts.map((old, i) => (i === index ? event.target.value : old)))
              }
            />
          </label>
        ))}
        <label>
          Size ({fontSize} px)
          <input
            type="range"
            min={8}
            max={60}
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
          />
        </label>
        <label>
          Tracking ({tracking})
          <input
            type="range"
            min={0}
            max={400}
            step={10}
            value={tracking}
            onChange={(event) => setTracking(Number(event.target.value))}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={showFrames}
            onChange={(event) => setShowFrames(event.target.checked)}
          />
          Show where each rigid unit starts
        </label>
      </form>
      <canvas ref={canvasRef} aria-label="Sample roads with names set along them" />
    </main>
  );
}
