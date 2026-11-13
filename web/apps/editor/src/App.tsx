import { TextSpike } from './TextSpike';

/**
 * Milestone M0: there is no editor yet. The page shows the text-shaping spike,
 * which proves the riskiest piece (labels shaped from font bytes and set along
 * a path, in Latin and non-Latin scripts) before anything is built on it.
 */
export function App() {
  return (
    <>
      <header className="toolbar">
        <h1>Nolli</h1>
        <span>Text-on-path spike (milestone M0)</span>
      </header>
      <TextSpike />
    </>
  );
}
