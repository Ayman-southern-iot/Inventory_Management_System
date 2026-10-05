import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from './Toast';

function Buttons() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success('Saved.')}>
        ok
      </button>
      <button type="button" onClick={() => toast.error('That did not work.')}>
        fail
      </button>
    </>
  );
}

/**
 * Message audit M9. An error toast sat in a polite live region, so a screen reader announced a
 * failure only when it was otherwise idle. A failure is announced at once; a success is not urgent.
 */
describe('Toast announcements', () => {
  it('announces an error assertively, as an alert', async () => {
    render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>,
    );
    await act(async () => screen.getByText('fail').click());
    expect(screen.getByRole('alert')).toHaveTextContent('That did not work.');
  });

  it('announces a success politely, as a status', async () => {
    render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>,
    );
    await act(async () => screen.getByText('ok').click());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });
});
