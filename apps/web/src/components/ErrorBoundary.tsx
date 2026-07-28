import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { t } from '@/i18n/en';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render-time crashes so one broken screen does not white-screen the whole app.
 * Still a class component — React has no hook equivalent for `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nowhere to ship this yet; Phase 06 adds monitoring. The console is the honest interim.
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle aria-hidden className="size-8 text-danger" />
        <p className="text-sm font-medium text-ink">{t.states.crashTitle}</p>
        <p className="max-w-sm text-sm text-ink-muted">{t.states.crashBody}</p>
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          {t.states.reload}
        </Button>
      </div>
    );
  }
}
