/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
// Bundle pdf.js's worker as a same-origin Vite worker so the desktop webview
// needs no network access and the Tauri CSP keeps script-src 'self'.
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import styles from './PdfCanvasPreview.module.css';

pdfjs.GlobalWorkerOptions.workerPort = new PdfjsWorker();

/** Render scale applied to each PDF page before drawing to a canvas. */
const RENDER_SCALE = 1.5;

export interface PdfCanvasPreviewProps {
  /** Absolute URL returning an inline PDF (e.g. the knowledge-base page endpoint). */
  url: string;
  /** Shown above the pages. */
  title: string;
  /** 1-based page to scroll to once rendered; ignored when absent. */
  page?: number;
}

/**
 * Renders a remote PDF into canvases with pdf.js. This exists because the
 * desktop webview (WebKitGTK) has no built-in PDF viewer: an <iframe> pointing
 * at a PDF renders blank there, while pdf.js draws it ourselves.
 */
export function PdfCanvasPreview({ url, title, page }: PdfCanvasPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    setStatus('loading');
    setError(null);

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data });
        const doc = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          const pdfPage = await doc.getPage(pageNumber);
          if (cancelled) break;
          const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = styles.canvas;
          canvas.dataset['pageNumber'] = String(pageNumber);
          container.appendChild(canvas);
          await pdfPage.render({ canvas, viewport }).promise;
        }
        if (cancelled) return;
        setStatus('ready');
        if (page && page > 0) {
          container
            .querySelector(`canvas[data-page-number="${page}"]`)
            ?.scrollIntoView({ block: 'start' });
        }
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, page]);

  return (
    <div className={styles.root}>
      <div className={styles.title}>{title}</div>
      <div className={styles.pages} ref={containerRef} />
      {status === 'loading' && <div className={styles.status}>加载中…</div>}
      {status === 'error' && (
        <div className={styles.error}>PDF 加载失败：{error}</div>
      )}
    </div>
  );
}
