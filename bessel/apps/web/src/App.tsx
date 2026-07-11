// App root: the viewer owns the modern shell (app bar, dock, timeline), the state
// store, and the engine. This component is just the mount point.
import { BesselViewer } from './viewer.tsx';

export function App(): JSX.Element {
  return <BesselViewer />;
}
