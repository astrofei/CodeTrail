import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from './App';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

describe('CodeTrail editor', () => {
  it('renders the canvas shell and can add a node', async () => {
    render(<App />);

    expect(screen.getByText('CodeTrail')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add Node'));

    expect(screen.getByText('New function')).toBeInTheDocument();
  });

  it('shows the inline language picker on code nodes', async () => {
    render(<App />);

    const node = screen.getByText('A.entry').closest('.code-node') as HTMLElement | null;
    expect(node).toBeInTheDocument();

    fireEvent.click(node!);
    await waitFor(() => expect(within(node!).getByTitle('Language')).toBeInTheDocument());
  });

  it('focuses a code node on double click', async () => {
    render(<App />);

    const node = screen.getByText('A.entry').closest('.code-node') as HTMLElement | null;
    expect(node).toBeInTheDocument();

    fireEvent.doubleClick(node!);
    await waitFor(() => expect(node).toHaveClass('is-focused', 'nowheel', 'nopan'));
  });

  it('restores canvas controls when clicking outside a focused node', async () => {
    render(<App />);

    const node = screen.getByText('A.entry').closest('.code-node') as HTMLElement | null;
    const canvas = document.querySelector('.canvas') as HTMLElement | null;
    expect(node).toBeInTheDocument();
    expect(canvas).toBeInTheDocument();

    fireEvent.doubleClick(node!);
    await waitFor(() => expect(node).toHaveClass('is-focused'));

    fireEvent.click(canvas!);
    await waitFor(() => expect(node).not.toHaveClass('is-focused'));
    expect(screen.getByText('Canvas zoom restored.')).toBeInTheDocument();
  });

  it('routes wheel events to the focused code panel', async () => {
    render(<App />);

    const node = screen.getByText('A.entry').closest('.code-node') as HTMLElement | null;
    const canvas = document.querySelector('.canvas') as HTMLElement | null;
    expect(node).toBeInTheDocument();
    expect(canvas).toBeInTheDocument();

    fireEvent.doubleClick(node!);
    await waitFor(() => expect(node).toHaveClass('is-focused'));

    const originalScrollBy = HTMLElement.prototype.scrollBy;
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
      configurable: true,
      value: scrollBy
    });

    try {
      fireEvent.wheel(canvas!, { deltaX: 9, deltaY: 120 });
      expect(scrollBy).toHaveBeenCalledWith({ left: 9, top: 120, behavior: 'auto' });
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
        configurable: true,
        value: originalScrollBy
      });
    }
  });
});
