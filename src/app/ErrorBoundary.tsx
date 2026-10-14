import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadForNewDeploy } from './chunkReload';

interface Props {
  children: ReactNode;
  /** Short name of the area, shown in the message ("3D view"). */
  area?: string;
  /** Compact inline message instead of a full-page one. */
  inline?: boolean;
  /** Called by "Close scan" / "Start over". */
  onReset?: () => void;
  resetLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a rendering failure from blanking the whole app. The page-level
 * boundary offers reload and start-over; inline boundaries around optional
 * panels (3D, tooth review) leave the slices usable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!this.props.inline && isChunkLoadError(error) && reloadForNewDeploy())
      return;
    console.error(
      `CBCTer ${this.props.area ?? 'app'} error`,
      error,
      info.componentStack,
    );
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { area, inline, onReset, resetLabel } = this.props;
    const chunk = isChunkLoadError(error);
    const title = chunk
      ? 'CBCTer was updated'
      : `Something went wrong${area ? ` in the ${area}` : ''}`;
    const detail = chunk
      ? 'Reload the page to get the new version.'
      : error.message || 'Unknown error';
    const button =
      'min-h-10 rounded border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100 hover:bg-slate-700';
    const actions = (
      <div className="mt-3 flex flex-wrap gap-2">
        {!chunk && (
          <button type="button" className={button} onClick={this.retry}>
            Try again
          </button>
        )}
        <button
          type="button"
          className={button}
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
        {onReset && (
          <button
            type="button"
            className={button}
            onClick={() => {
              this.retry();
              onReset();
            }}
          >
            {resetLabel ?? 'Start over'}
          </button>
        )}
      </div>
    );
    if (inline)
      return (
        <div
          role="alert"
          className="m-2 rounded border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-100"
        >
          <strong className="block">{title}</strong>
          <span className="mt-1 block text-xs text-rose-200/80">{detail}</span>
          {actions}
        </div>
      );
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div
          role="alert"
          className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-5"
        >
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-2 break-words text-sm text-slate-300">{detail}</p>
          <p className="mt-2 text-xs text-slate-400">
            Your scan never left this device. Saved cases stay in this browser.
          </p>
          {actions}
        </div>
      </main>
    );
  }
}
