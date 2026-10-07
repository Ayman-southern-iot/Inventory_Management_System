import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { t } from '@/i18n/en';
import { OnScreenKeyboard, type KeyboardLayout } from './OnScreenKeyboard';

/** The keyboard drives a field the way the panel's search bar and the kiosk login do. */
function Harness({ layout }: { layout?: KeyboardLayout }) {
  const [value, setValue] = useState('');
  return (
    <>
      <output aria-label="typed">{value}</output>
      <OnScreenKeyboard
        layout={layout}
        onKey={(text) => setValue((current) => current + text)}
        onBackspace={() => setValue((current) => current.slice(0, -1))}
        onClear={() => setValue('')}
      />
    </>
  );
}

const typed = () => screen.getByLabelText('typed').textContent;
const key = (name: string) => screen.getByRole('button', { name });

describe('OnScreenKeyboard, search layout', () => {
  it('types letters, digits and the hyphen an address needs', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const name of ['A', '1', '-', '1', 'G']) await user.click(key(name));
    expect(typed()).toBe('A1-1G');
  });

  it('types a space, deletes the last character, and clears everything', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const name of ['S', 'T', t.onScreenKeyboard.space, 'L']) await user.click(key(name));
    expect(typed()).toBe('ST L');

    await user.click(key(t.onScreenKeyboard.backspace));
    expect(typed()).toBe('ST ');

    await user.click(key(t.onScreenKeyboard.clear));
    expect(typed()).toBe('');
  });

  it('has every digit and every letter of the alphabet, once', () => {
    render(<Harness />);
    for (const name of [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-./_']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(1);
    }
  });
});

describe('OnScreenKeyboard, search layout, part numbers', () => {
  it('types the dot, slash and underscore part numbers use', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    for (const name of [
      ...'0.1UF',
      t.onScreenKeyboard.space,
      ...'LM358/N',
      t.onScreenKeyboard.space,
      ...'A_B',
    ]) {
      await user.click(key(name));
    }
    expect(typed()).toBe('0.1UF LM358/N A_B');
  });
});

describe('OnScreenKeyboard, text layout (sign-in)', () => {
  it('types an email address in lower case', async () => {
    const user = userEvent.setup();
    render(<Harness layout="text" />);
    for (const name of [...'lab', '-', ...'panel', '@', ...'siot', '.', ...'lab']) {
      await user.click(key(name));
    }
    expect(typed()).toBe('lab-panel@siot.lab');
  });

  it('types capitals while Shift is on, and lower case again once it is off', async () => {
    const user = userEvent.setup();
    render(<Harness layout="text" />);
    await user.click(key(t.onScreenKeyboard.shift));
    expect(key(t.onScreenKeyboard.shift)).toHaveAttribute('aria-pressed', 'true');
    await user.click(key('P'));
    await user.click(key(t.onScreenKeyboard.shift));
    await user.click(key('w'));
    expect(typed()).toBe('Pw');
  });

  it('types the symbols a password may hold, then goes back to letters', async () => {
    const user = userEvent.setup();
    render(<Harness layout="text" />);
    await user.click(key(t.onScreenKeyboard.symbols));
    for (const name of ['!', '#', '$', '%', '&', '*', '(', ')', '+', '=', '?', '/', '_']) {
      await user.click(key(name));
    }
    await user.click(key(t.onScreenKeyboard.letters));
    await user.click(key('z'));
    expect(typed()).toBe('!#$%&*()+=?/_z');
  });
});

describe('OnScreenKeyboard, either layout', () => {
  it('keeps the field being typed into focused when a key is touched', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="field" />
        <OnScreenKeyboard onKey={() => {}} onBackspace={() => {}} onClear={() => {}} />
      </>,
    );
    const field = screen.getByLabelText('field');
    field.focus();
    await user.click(key('Q'));
    expect(field).toHaveFocus();
  });

  it('sizes every key at least 56 px, the kiosk touch target', () => {
    render(<Harness layout="text" />);
    // min-h-14 / min-w-14 = 3.5rem = 56 px at the default root size. jsdom has no layout, so the
    // class is what can be checked here; the Playwright run measures the real box.
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-14');
      expect(button.className).toContain('min-w-14');
    }
  });
});
