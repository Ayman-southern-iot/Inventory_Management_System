import { useState, type MouseEvent, type ReactNode } from 'react';
import { Delete } from 'lucide-react';
import { t } from '@/i18n/en';

/**
 * A keyboard for a touch screen that has none of its own: the lab panel's kiosk.
 *
 * - `search` types what a part search needs: digits, capitals and the hyphen of an address.
 * - `text` types what a sign-in needs: lower and upper case (Shift), `@` and `.` for an email,
 *   and a symbols page for a password.
 * Space is on both: part names and passwords can contain one.
 */
export type KeyboardLayout = 'search' | 'text';

const SEARCH_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL-', 'ZXCVBNM'] as const;
const LETTER_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl@', 'zxcvbnm.'] as const;
const SYMBOL_ROWS = ['1234567890', '!#$%&*()+=', '/\\?:;,\'"~`', '<>[]{}^|'] as const;
/** Always on the text layout's bottom row: email addresses and passwords use them. */
const TEXT_EXTRA_KEYS = ['-', '_'] as const;

interface OnScreenKeyboardProps {
  layout?: KeyboardLayout;
  onKey: (text: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}

/**
 * Keeps focus (and the caret) in the field being typed into. Cancelling `mousedown` stops the
 * focus move and nothing else; a touch also produces one, and the click still fires.
 */
function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function Key({
  label,
  onPress,
  children,
  wide = false,
  isPressed,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  wide?: boolean;
  isPressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isPressed}
      onMouseDown={keepFocus}
      onClick={onPress}
      className={`flex min-h-14 min-w-14 items-center justify-center rounded-control border border-border-strong bg-surface text-2xl font-semibold text-ink active:bg-brand-subtle aria-pressed:bg-brand-subtle ${wide ? 'flex-3' : 'flex-1'}`}
    >
      {children}
    </button>
  );
}

export function OnScreenKeyboard({
  layout = 'search',
  onKey,
  onBackspace,
  onClear,
}: OnScreenKeyboardProps) {
  const [isShifted, setShifted] = useState(false);
  const [isSymbols, setSymbols] = useState(false);
  const rows = layout === 'search' ? SEARCH_ROWS : isSymbols ? SYMBOL_ROWS : LETTER_ROWS;
  const shown = (char: string) => (isShifted ? char.toUpperCase() : char);

  return (
    <div
      role="group"
      aria-label={t.onScreenKeyboard.label}
      className="flex flex-col gap-2 border-t border-border bg-surface-muted p-3"
    >
      {rows.map((row, rowIndex) => (
        <div key={row} className="flex gap-2">
          {[...row].map((char) => (
            <Key key={char} label={shown(char)} onPress={() => onKey(shown(char))}>
              {shown(char)}
            </Key>
          ))}
          {rowIndex === rows.length - 1 ? (
            <Key label={t.onScreenKeyboard.backspace} onPress={onBackspace} wide>
              <Delete aria-hidden className="size-8" />
            </Key>
          ) : null}
        </div>
      ))}
      <div className="flex gap-2">
        {layout === 'text' ? (
          <>
            <Key
              label={t.onScreenKeyboard.shift}
              onPress={() => setShifted((on) => !on)}
              isPressed={isShifted}
            >
              {t.onScreenKeyboard.shift}
            </Key>
            <Key
              label={isSymbols ? t.onScreenKeyboard.letters : t.onScreenKeyboard.symbols}
              onPress={() => setSymbols((on) => !on)}
            >
              {isSymbols ? t.onScreenKeyboard.lettersKey : t.onScreenKeyboard.symbolsKey}
            </Key>
            {TEXT_EXTRA_KEYS.map((char) => (
              <Key key={char} label={char} onPress={() => onKey(char)}>
                {char}
              </Key>
            ))}
          </>
        ) : null}
        <Key label={t.onScreenKeyboard.space} onPress={() => onKey(' ')} wide>
          {t.onScreenKeyboard.space}
        </Key>
        <Key label={t.onScreenKeyboard.clear} onPress={onClear}>
          {t.onScreenKeyboard.clear}
        </Key>
      </div>
    </div>
  );
}
