// First-run welcome card shown on the empty canvas. Two large actions: load the
// bundled sample mission or just explore the solar system, plus a "don't show again"
// checkbox. By default it appears on every cold open; checking the box opts out for
// future visits. Eager and presentational (no heavy deps), so it does not grow the
// first-paint shell. The backdrop is pointer-transparent so it never blocks the scene;
// only the card itself is interactive.

import { useState } from 'react';
import { Button } from '@bessel/selene-design';

export interface WelcomeCardProps {
  /** Each action receives whether the user opted to not show the welcome again, so the
   *  host can persist that preference while it closes the card for this session. */
  readonly onLoadSample: (dontShowAgain: boolean) => void;
  readonly onExplore: (dontShowAgain: boolean) => void;
  readonly onClose: (dontShowAgain: boolean) => void;
}

export function WelcomeCard(props: WelcomeCardProps): JSX.Element {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  return (
    <div className="bessel-welcome-backdrop" data-testid="welcome-card">
      <section
        className="bessel-welcome"
        role="dialog"
        aria-modal="false"
        aria-labelledby="bessel-welcome-title"
      >
        <button
          type="button"
          className="bessel-welcome-close"
          onClick={() => props.onClose(dontShowAgain)}
          aria-label="Dismiss welcome"
          data-testid="welcome-close"
        >
          <span aria-hidden="true">✕</span>
        </button>
        <h2 id="bessel-welcome-title" className="bessel-welcome-title">
          Welcome to Bessel
        </h2>
        <p className="bessel-welcome-lede">
          A SPICE-aware mission viewer. Start with the bundled mission, or just explore the
          solar system.
        </p>
        <div className="bessel-welcome-actions">
          <Button
            variant="primary"
            full
            onClick={() => props.onLoadSample(dontShowAgain)}
            testId="welcome-load-sample"
          >
            Load the sample mission
          </Button>
          <Button
            variant="secondary"
            full
            onClick={() => props.onExplore(dontShowAgain)}
            testId="welcome-explore"
          >
            Explore the solar system
          </Button>
        </div>
        <label className="bessel-welcome-dismiss">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            data-testid="welcome-dont-show-again"
          />
          Don&apos;t show this again
        </label>
      </section>
    </div>
  );
}
