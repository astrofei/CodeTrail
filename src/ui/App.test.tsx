import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from './App';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

describe('CodeTrail editor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('renders the canvas shell and can add a node', async () => {
    render(<App />);

    expect(screen.getByLabelText('Project library title')).toHaveValue('Project Library');
    expect(screen.getByLabelText('New project')).toBeInTheDocument();
    expect(screen.queryByText('Add Node')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Scope')).not.toBeInTheDocument();
    expect(screen.getByText('A.entry')).toBeInTheDocument();
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

  it('loads a hosted project from the project library sidebar', async () => {
    const hostedDocument = {
      version: 1,
      metadata: {
        title: 'Hosted study',
        description: '',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      nodes: [
        {
          id: 'node_hosted',
          title: 'Hosted.entry',
          language: 'typescript',
          summary: 'Loaded from the hosted project folder.',
          codeSnapshot: 'function hosted() {\n  return true;\n}',
          position: { x: 120, y: 120 },
          size: { width: 360, height: 280 },
          collapsed: false,
          color: '#e0f2fe',
          scopeId: null,
          callAnchors: []
        }
      ],
      edges: [],
      scopes: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith('/projects/hosted-study.codetrail.json')) {
        return Promise.resolve(new Response(JSON.stringify(hostedDocument), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      const projectTitle = await screen.findByText('Hosted study');
      fireEvent.click(projectTitle.closest('.project-list__item')!);

      await waitFor(() => expect(screen.getByText('Hosted.entry')).toBeInTheDocument());
      expect(screen.getByText('Loaded hosted project Hosted study.')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens project actions from a sidebar item context menu', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      const projectTitle = await screen.findByText('Hosted study');
      fireEvent.contextMenu(projectTitle.closest('.project-list__item')!, {
        clientX: 120,
        clientY: 180
      });

      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save As' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Export HTML' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('deletes a project from the sidebar item action', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      const projectTitle = await screen.findByText('Hosted study');
      fireEvent.click(screen.getByLabelText('Delete Hosted study'));

      expect(projectTitle).not.toBeInTheDocument();
      expect(screen.getByText('Deleted Hosted study locally only. Add a GitHub token to move remote files to trash.')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('moves a GitHub-backed project file to trash before deleting it from the project folder', async () => {
    window.localStorage.setItem(
      'codetrail.githubSyncConfig',
      JSON.stringify({
        owner: 'astrofei',
        repo: 'CodeTrail',
        branch: 'main',
        folder: 'public/projects',
        token: 'test-token'
      })
    );
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1779440000000);
    const hostedDocument = {
      version: 1,
      metadata: {
        title: 'Hosted study',
        description: 'A hosted fixture.',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      nodes: [],
      edges: [],
      scopes: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith('/projects/hosted-study.codetrail.json')) {
        return Promise.resolve(new Response(JSON.stringify(hostedDocument), { status: 200 }));
      }
      if (url.includes('/contents/public/projects/trash/') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: 'trash-sha' } }), { status: 200 }));
      }
      if (url.includes('/contents/public/projects/hosted-study.codetrail.json') && init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ content: null }), { status: 200 }));
      }
      if (url.includes('/contents/public/projects/manifest.json') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: 'manifest-sha-next' } }), { status: 200 }));
      }
      if (url.includes('/contents/public/projects/trash/')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      if (url.includes('/contents/public/projects/hosted-study.codetrail.json')) {
        return Promise.resolve(new Response(JSON.stringify({ sha: 'project-sha' }), { status: 200 }));
      }
      if (url.includes('/contents/public/projects/manifest.json')) {
        return Promise.resolve(new Response(JSON.stringify({ sha: 'manifest-sha' }), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      await screen.findByText('Hosted study');
      fireEvent.click(screen.getByLabelText('Delete Hosted study'));

      await waitFor(() => expect(screen.getAllByText(/Moved Hosted study to GitHub trash/).length).toBeGreaterThan(0));

      const calls = fetchMock.mock.calls.map(([input, init]) => ({ url: String(input), method: init?.method }));
      const trashPutIndex = calls.findIndex(
        (call) => call.method === 'PUT' && call.url.includes('/contents/public/projects/trash/1779440000000-hosted-study.codetrail.json')
      );
      const deleteIndex = calls.findIndex(
        (call) => call.method === 'DELETE' && call.url.includes('/contents/public/projects/hosted-study.codetrail.json')
      );
      const manifestPutIndex = calls.findIndex(
        (call) => call.method === 'PUT' && call.url.includes('/contents/public/projects/manifest.json')
      );
      expect(trashPutIndex).toBeGreaterThanOrEqual(0);
      expect(deleteIndex).toBeGreaterThan(trashPutIndex);
      expect(manifestPutIndex).toBeGreaterThan(deleteIndex);
    } finally {
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('edits sidebar project metadata only after double click', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      const title = await screen.findByText('Hosted study');
      expect(screen.queryByLabelText('Hosted study title')).not.toBeInTheDocument();

      fireEvent.doubleClick(title.closest('.project-list__item')!);

      const titleInput = await screen.findByLabelText('Hosted study title');
      expect(titleInput).toHaveValue('Hosted study');
      expect(screen.getByLabelText('Hosted study description')).toHaveValue('A hosted fixture.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uploads the previous project to GitHub before creating a new one', async () => {
    window.localStorage.setItem(
      'codetrail.githubSyncConfig',
      JSON.stringify({
        owner: 'astrofei',
        repo: 'CodeTrail',
        branch: 'main',
        folder: 'public/projects',
        token: 'test-token'
      })
    );
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
      }
      if (url.startsWith('https://api.github.com/') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: 'next-sha' } }), { status: 200 }));
      }
      if (url.startsWith('https://api.github.com/')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      fireEvent.click(screen.getByLabelText('New project'));

      await waitFor(() => {
        const putUrls = fetchMock.mock.calls
          .filter(([, init]) => init?.method === 'PUT')
          .map(([input]) => String(input));
        expect(putUrls.some((url) => url.includes('/contents/public/projects/project-'))).toBe(true);
        expect(putUrls.some((url) => url.includes('/contents/public/projects/manifest.json'))).toBe(true);
      });
      expect(screen.getByText('Current project saved to the sidebar. New project created.')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a saved GitHub token hidden until the user changes it', async () => {
    window.localStorage.setItem(
      'codetrail.githubSyncConfig',
      JSON.stringify({
        owner: 'astrofei',
        repo: 'CodeTrail',
        branch: 'main',
        folder: 'public/projects',
        token: 'saved-token'
      })
    );
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))));

    try {
      render(<App />);

      expect(screen.getByText('Token saved')).toBeInTheDocument();
      expect(screen.queryByLabelText('GitHub token')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Change' }));
      expect(screen.getByLabelText('GitHub token')).toHaveValue('saved-token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hides advanced GitHub repository settings by default', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }))));

    try {
      render(<App />);

      expect(screen.getByText('GitHub Sync')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('astrofei')).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue('CodeTrail')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

      expect(screen.getByDisplayValue('astrofei')).toBeInTheDocument();
      expect(screen.getByDisplayValue('CodeTrail')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders a single project without the sidebar for Notion embed links', async () => {
    const hostedDocument = {
      version: 1,
      metadata: {
        title: 'Hosted study',
        description: '',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      nodes: [
        {
          id: 'node_hosted',
          title: 'Hosted.entry',
          language: 'typescript',
          summary: 'Loaded from the hosted project folder.',
          codeSnapshot: 'function hosted() {\n  return true;\n}',
          position: { x: 120, y: 120 },
          size: { width: 360, height: 280 },
          collapsed: false,
          color: '#e0f2fe',
          scopeId: null,
          callAnchors: []
        }
      ],
      edges: [],
      scopes: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith('/projects/hosted-study.codetrail.json')) {
        return Promise.resolve(new Response(JSON.stringify(hostedDocument), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/?embed=1&project=hosted-study.codetrail.json');

    try {
      render(<App />);

      await waitFor(() => expect(screen.getByText('Hosted.entry')).toBeInTheDocument());
      expect(screen.queryByLabelText('Hosted project library')).not.toBeInTheDocument();
      expect(screen.getByText('Auto-saves locally after edits.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('loads an embedded project directly when it is missing from the manifest', async () => {
    const directDocument = {
      version: 1,
      metadata: {
        title: 'Direct embed study',
        description: '',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      nodes: [
        {
          id: 'node_direct',
          title: 'Direct.entry',
          language: 'typescript',
          summary: 'Loaded directly from project query.',
          codeSnapshot: 'function direct() {\n  return true;\n}',
          position: { x: 120, y: 120 },
          size: { width: 360, height: 280 },
          collapsed: false,
          color: '#e0f2fe',
          scopeId: null,
          callAnchors: []
        }
      ],
      edges: [],
      scopes: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
      }
      if (url.endsWith('/projects/project-1779421516724-f3c27fcf.codetrail.json')) {
        return Promise.resolve(new Response(JSON.stringify(directDocument), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/?embed=1&project=project-1779421516724-f3c27fcf.codetrail.json');

    try {
      render(<App />);

      await waitFor(() => expect(screen.getByText('Direct.entry')).toBeInTheDocument());
      expect(screen.queryByText('Project not found for project-1779421516724-f3c27fcf.codetrail.json.')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Hosted project library')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('auto-saves embed edits into the local project library', async () => {
    const hostedDocument = {
      version: 1,
      metadata: {
        title: 'Hosted study',
        description: 'A hosted fixture.',
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z'
      },
      nodes: [
        {
          id: 'hosted_node',
          title: 'Hosted.entry',
          language: 'ts',
          summary: 'Loaded from the hosted project folder.',
          codeSnapshot: 'export function hosted() {}',
          position: { x: 100, y: 100 },
          size: { width: 320, height: 240 },
          collapsed: false,
          color: '#fff7ed',
          scopeId: null,
          callAnchors: []
        }
      ],
      edges: [],
      scopes: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith('/projects/hosted-study.codetrail.json')) {
        return Promise.resolve(new Response(JSON.stringify(hostedDocument), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/?embed=1&project=hosted-study.codetrail.json');

    try {
      render(<App />);

      const title = await screen.findByText('Hosted.entry');
      fireEvent.click(title.closest('.code-node')!);
      vi.useFakeTimers();
      fireEvent.click(screen.getByTitle('Collapse node'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      vi.useRealTimers();

      const projects = JSON.parse(window.localStorage.getItem('codetrail.projectLibrary') ?? '[]');
      expect(projects[0].path).toBe('hosted-study.codetrail.json');
      expect(projects[0].document.nodes[0].collapsed).toBe(true);
      expect(screen.getByText('Auto-saved Hosted study.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('auto-saves current document edits to GitHub even before a project is manually saved', async () => {
    window.localStorage.setItem(
      'codetrail.githubSyncConfig',
      JSON.stringify({
        owner: 'astrofei',
        repo: 'CodeTrail',
        branch: 'main',
        folder: 'public/projects',
        token: 'test-token'
      })
    );
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
      }
      if (url.startsWith('https://api.github.com/') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: 'next-sha' } }), { status: 200 }));
      }
      if (url.startsWith('https://api.github.com/')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    try {
      render(<App />);

      const node = screen.getByText('A.entry').closest('.code-node')!;
      fireEvent.click(node);
      fireEvent.click(within(node as HTMLElement).getByTitle('Collapse node'));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });

      await act(async () => {
        await Promise.resolve();
      });

      const putUrls = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PUT')
        .map(([input]) => String(input));
      expect(putUrls.some((url) => url.includes('/contents/public/projects/project-'))).toBe(true);
      expect(putUrls.some((url) => url.includes('/contents/public/projects/manifest.json'))).toBe(true);
      expect(screen.getByText('Auto-saved CodeTrail Study Map to GitHub.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('creates a GitHub project automatically when a token is configured and no project is active', async () => {
    window.localStorage.setItem(
      'codetrail.githubSyncConfig',
      JSON.stringify({
        owner: 'astrofei',
        repo: 'CodeTrail',
        branch: 'main',
        folder: 'public/projects',
        token: 'test-token'
      })
    );
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
      }
      if (url.startsWith('https://api.github.com/') && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({ content: { sha: 'next-sha' } }), { status: 200 }));
      }
      if (url.startsWith('https://api.github.com/')) {
        return Promise.resolve(new Response('', { status: 404 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    try {
      render(<App />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });
      await act(async () => {
        await Promise.resolve();
      });

      const putUrls = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'PUT')
        .map(([input]) => String(input));
      expect(putUrls.some((url) => url.includes('/contents/public/projects/project-'))).toBe(true);
      expect(putUrls.some((url) => url.includes('/contents/public/projects/manifest.json'))).toBe(true);
      expect(screen.getByText('Auto-saved CodeTrail Study Map to GitHub.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('copies a separate Notion link for a project item', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/projects/manifest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              files: [
                {
                  title: 'Hosted study',
                  path: 'hosted-study.codetrail.json',
                  description: 'A hosted fixture.'
                }
              ]
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<App />);

      const projectTitle = await screen.findByText('Hosted study');
      fireEvent.contextMenu(projectTitle.closest('.project-list__item')!, {
        clientX: 120,
        clientY: 180
      });
      fireEvent.click(screen.getByRole('button', { name: 'Copy Notion Link' }));

      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('embed=1'));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('project=hosted-study.codetrail.json'));
      await waitFor(() => expect(screen.getByText('Copied Notion link for Hosted study.')).toBeInTheDocument());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('can add a description to a scope from the scope title chip', async () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText('Add note for Reading scope'));
    const description = screen.getByLabelText('Reading scope description');
    fireEvent.change(description, { target: { value: 'Scope responsibility note.' } });
    fireEvent.blur(description);

    expect(await screen.findByDisplayValue('Scope responsibility note.')).toBeInTheDocument();
  });

  it('shows color controls for selected nodes and scopes', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('A.entry').closest('.code-node')!);
    expect(screen.getByLabelText('A.entry color')).toBeInTheDocument();

    const scopeNode = screen.getAllByText('Reading scope')
      .map((element) => element.closest('.scope-node'))
      .find((element): element is HTMLElement => element instanceof HTMLElement);
    expect(scopeNode).toBeInTheDocument();
    fireEvent.click(scopeNode!);
    await waitFor(() => expect(screen.getByLabelText('Reading scope color')).toBeInTheDocument());
  });
});
