import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorCode } from '@ims/shared';
import { ApiError } from '@/api/client';
import { t } from '@/i18n/en';
import { QueryBoundary, ErrorState } from './states';

describe('QueryBoundary', () => {
  const renderBoundary = (props: Partial<Parameters<typeof QueryBoundary<string[]>>[0]>) =>
    render(
      <QueryBoundary<string[]>
        isLoading={false}
        error={null}
        data={undefined}
        isEmpty={(data) => data.length === 0}
        {...props}
      >
        {(data) => <ul>{data.map((item) => <li key={item}>{item}</li>)}</ul>}
      </QueryBoundary>,
    );

  it('shows loading before anything else', () => {
    renderBoundary({ isLoading: true, data: ['a'] });
    expect(screen.getByRole('status')).toHaveTextContent(t.common.loading);
  });

  it('shows the error state, not an empty list, when the request failed', () => {
    renderBoundary({ error: new ApiError(ErrorCode.INTERNAL, 'boom', 500), data: [] });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(t.states.emptyTitle)).not.toBeInTheDocument();
  });

  it('distinguishes empty from loading — an empty list is a real answer', () => {
    renderBoundary({ data: [] });
    expect(screen.getByText(t.states.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the data once loaded', () => {
    renderBoundary({ data: ['first', 'second'] });
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('offers a retry for a transient failure', async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={new ApiError(ErrorCode.INTERNAL, 'boom', 500)} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: t.common.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not offer a retry for a permission failure — retrying cannot help', () => {
    render(
      <ErrorState
        error={new ApiError(ErrorCode.FORBIDDEN, 'nope', 403)}
        onRetry={() => undefined}
      />,
    );

    expect(screen.getByText(t.states.forbiddenTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.common.retry })).not.toBeInTheDocument();
  });

  it('tells the user it is a connection problem rather than a server error', () => {
    render(<ErrorState error={new ApiError('NETWORK', 'unreachable', 0)} />);
    expect(screen.getByText(t.states.offlineTitle)).toBeInTheDocument();
  });
});
