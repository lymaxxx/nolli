import { ProjectFiles } from './ProjectFiles';

/**
 * Milestone M3: the project shell with a live map. Layer and style editing
 * arrive in the later milestones; the text-shaping sample stays reachable.
 */
export function App() {
  return (
    <>
      <header className="toolbar">
        <h1>Nolli</h1>
        <span>Map (milestone M3)</span>
      </header>
      <ProjectFiles />
    </>
  );
}
