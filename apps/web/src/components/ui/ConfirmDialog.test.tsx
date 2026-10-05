import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@/i18n/en';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  function open(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Deactivate Gina General?"
        body="They will not be able to sign in."
        confirmLabel="Deactivate"
        onConfirm={onConfirm}
        onClose={onClose}
        {...overrides}
      />,
    );
    return { onConfirm, onClose };
  }

  it('says what will happen before anything does', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Deactivate Gina General?' })).toBeInTheDocument();
    expect(screen.getByText('They will not be able to sign in.')).toBeInTheDocument();
  });

  it('does nothing until it is confirmed', () => {
    const { onConfirm } = open();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the named action', async () => {
    const { onConfirm } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels without confirming', async () => {
    const { onConfirm, onClose } = open();
    await userEvent.click(screen.getByRole('button', { name: t.common.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape without confirming', async () => {
    const { onConfirm, onClose } = open();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog open={false} title="t" body="b" confirmLabel="c" onConfirm={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
