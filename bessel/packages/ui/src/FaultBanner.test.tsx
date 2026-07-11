import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { FaultBanner } from './FaultBanner.tsx';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('@bessel/ui FaultBanner', () => {
  it('renders nothing when there is no fault', () => {
    expect(html(createElement(FaultBanner, { fault: null }))).toBe('');
  });

  it('renders a role=alert with the fault text when set', () => {
    const out = html(createElement(FaultBanner, { fault: 'frame is not JSON' }));
    expect(out).toContain('role="alert"');
    expect(out).toContain('Telemetry fault: frame is not JSON');
  });

  it('defaults to the overlay testid and honors a custom one', () => {
    expect(html(createElement(FaultBanner, { fault: 'x' }))).toContain(
      'data-testid="telemetry-fault-banner"',
    );
    expect(html(createElement(FaultBanner, { fault: 'x', testId: 'telemetry-fault-alert' }))).toContain(
      'data-testid="telemetry-fault-alert"',
    );
  });

  it('omits the acknowledge control when onAcknowledge is absent', () => {
    const out = html(createElement(FaultBanner, { fault: 'x' }));
    expect(out).not.toContain('fault-acknowledge');
    expect(out).toContain('<p ');
  });

  it('renders an acknowledge control when onAcknowledge is provided', () => {
    const out = html(
      createElement(FaultBanner, { fault: 'x', onAcknowledge: () => undefined }),
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain('Telemetry fault: x');
    expect(out).toContain('data-testid="fault-acknowledge"');
    expect(out).toContain('aria-label="Acknowledge telemetry fault"');
  });
});
