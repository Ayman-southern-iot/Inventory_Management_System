import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';

/**
 * Downloads an API path as a file.
 *
 * D-024: the export buttons used to be plain `<a href download>` anchors. Two things were
 * wrong and the second survives fixing the first. The href had no `/api/v1`, so Caddy's
 * `handle /api/*` never matched, the request fell through to the SPA, and its history
 * fallback returned index.html with a 200 — the browser then saved 722 bytes of HTML under a
 * `.csv` name, which is why it failed silently. And a corrected href would have 401'd anyway:
 * this app authenticates with a bearer header, and a browser cannot attach one to a top-level
 * navigation.
 *
 * `SupportingDocumentCard` reached the same conclusion for the same reason and says so in its
 * own comment. The difference here is that an export must arrive as a *file with a name*
 * rather than open in a tab, so the blob goes to a synthetic anchor carrying `download`.
 *
 * One instance guards one button: two of these means clicking CSV cannot cancel an in-flight
 * PDF, while double-clicking either is a no-op instead of a second request.
 */
export function useExportDownload(): {
  download: (path: string, filename: string) => Promise<void>;
  pending: boolean;
} {
  const [pending, setPending] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function download(path: string, filename: string): Promise<void> {
    if (pending) return;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const blob = await api.blob(path, controller.signal);
      if (controller.signal.aborted) return;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Not revoked synchronously: the browser reads the blob when it starts the download,
      // and pulling the URL out from under it in the same tick is the documented way to get
      // an empty file. Next tick is after the click has been dispatched.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setPending(false);
    }
  }

  return { download, pending };
}
