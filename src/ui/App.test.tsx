import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows inline node properties when a node is selected', async () => {
    render(<App />);

    const node = screen.getByText('A.entry').closest('.code-node');
    expect(node).toBeInTheDocument();

    fireEvent.click(node!);
    await waitFor(() => expect(screen.getByTitle('Language')).toBeInTheDocument());
    expect(screen.getByTitle('Node color')).toBeInTheDocument();
  });
});
