import { Keyboard, Search, X } from 'lucide-react';
import { t } from '@/i18n/en';

interface PanelSearchBarProps {
  value: string;
  isKeyboardOpen: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onToggleKeyboard: () => void;
  /** The field was touched: focus, or a tap on a field that already has focus. */
  onActivate: () => void;
}

/**
 * `inputMode="none"`: the on-screen keyboard below is the input method, and a browser that does
 * have a virtual keyboard must not raise a second one over the map. A hardware keyboard still
 * types into the field, which is how the panel is serviced and tested.
 */
export function PanelSearchBar({
  value,
  isKeyboardOpen,
  onChange,
  onClear,
  onToggleKeyboard,
  onActivate,
}: PanelSearchBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <label className="flex h-16 flex-1 items-center gap-3 rounded-control border-2 border-border-strong bg-canvas px-4 focus-within:border-brand">
        <Search aria-hidden className="size-8 shrink-0 text-ink-muted" />
        <span className="sr-only">{t.panel.searchLabel}</span>
        <input
          // Not type="search": Chromium adds its own clear cross beside the panel's Clear button.
          type="text"
          inputMode="none"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={t.panel.searchPlaceholder}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onActivate}
          // A tap on a field that kept focus fires no focus event; the keyboard must still open.
          onClick={onActivate}
          className="min-w-0 flex-1 bg-transparent text-2xl text-ink outline-none placeholder:text-ink-subtle"
        />
      </label>
      {value !== '' ? (
        <button
          type="button"
          aria-label={t.panel.clearSearch}
          onClick={onClear}
          className="flex size-16 items-center justify-center rounded-control border border-border-strong bg-surface text-ink"
        >
          <X aria-hidden className="size-8" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggleKeyboard}
        className={`flex h-16 items-center gap-2 rounded-control border border-border-strong px-4 text-xl text-ink ${isKeyboardOpen ? 'bg-brand-subtle' : 'bg-surface'}`}
      >
        <Keyboard aria-hidden className="size-8" />
        {isKeyboardOpen ? t.panel.keyboardHide : t.panel.keyboardShow}
      </button>
    </div>
  );
}
