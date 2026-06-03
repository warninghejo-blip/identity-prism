/**
 * LegalModal — renders a bundled legal page (terms/privacy/cookies/…) fully
 * INSIDE the app, never in an external browser.
 *
 * Why an iframe with srcDoc instead of a plain <a href="/terms.html">:
 * on Android (Capacitor) a top-level navigation to another .html is handed to
 * the system browser (Chrome), which then auto-translates the English page into
 * the device language (e.g. Russian). By fetching the HTML and injecting it as
 * srcDoc there is NO navigation at all — the content renders in the app's own
 * WebView, in English, with no Chrome translate prompt. Works identically on web.
 *
 * The legal pages' own nav ("IDENTITY PRISM" logo + "Back to home", both
 * href="/") would navigate the frame to a blank SPA → black screen. So once the
 * frame loads we intercept those links: the back link is renamed to "Back" and
 * logo/back/Home all close the modal (return to the picker). Cross-links between
 * legal pages load in-place inside the modal.
 */
import { useEffect, useRef, useState } from 'react';
import './LegalModal.css';

interface LegalModalProps {
  /** page slug without extension, e.g. "terms"; null = closed */
  slug: string | null;
  onClose: () => void;
}

export default function LegalModal({ slug, onClose }: LegalModalProps) {
  const [current, setCurrent] = useState<string | null>(slug);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setCurrent(slug);
  }, [slug]);

  useEffect(() => {
    if (!current) {
      setHtml(null);
      setError(false);
      return;
    }
    let active = true;
    setHtml(null);
    setError(false);
    fetch(`/${current}.html`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => {
        if (!active) return;
        // Inject <base> so relative assets (_legal_styles.css, phav.png) resolve
        // against the app origin, plus the no-translate signal inside the frame.
        const inject = `<base href="${window.location.origin}/"><meta name="google" content="notranslate">`;
        const withBase = /<head[^>]*>/i.test(text)
          ? text.replace(/<head[^>]*>/i, (m) => `${m}${inject}`)
          : `${inject}${text}`;
        setHtml(withBase);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [current]);

  // Hardware/native back closes the modal (not the underlying screen).
  useEffect(() => {
    if (!slug) return;
    const onBack = () => onClose();
    window.addEventListener('identityprism:nativeBack', onBack);
    return () => window.removeEventListener('identityprism:nativeBack', onBack);
  }, [slug, onClose]);

  const handleIframeLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    // Rename the page's "← Back to home" link to just "← Back".
    doc.querySelectorAll('a.nav-back').forEach((el) => {
      el.textContent = '← Back';
    });
    // Intercept link clicks (capture phase) so navigation never blanks the frame.
    doc.addEventListener(
      'click',
      (e) => {
        const target = e.target as HTMLElement | null;
        const a = (target?.closest?.('a') ?? null) as HTMLAnchorElement | null;
        if (!a) return;
        const href = a.getAttribute('href') || '';
        // logo / back / footer "Home" → return to the picker
        if (href === '/' || href === '' || href === '#') {
          e.preventDefault();
          onClose();
          return;
        }
        // internal legal cross-link (e.g. /privacy.html) → load it in the modal
        const m = href.match(/^\/?([a-z0-9_-]+)\.html(?:[?#].*)?$/i);
        if (m && !/^https?:\/\//i.test(href)) {
          e.preventDefault();
          setCurrent(m[1]);
        }
        // mailto:, tel:, external https → leave default behaviour
      },
      true,
    );
  };

  if (!slug) return null;

  return (
    <div className="legal-modal-overlay" role="dialog" aria-modal="true">
      {error ? (
        <div className="legal-modal-msg">Could not load this page. Please try again.</div>
      ) : html ? (
        <iframe
          ref={iframeRef}
          className="legal-modal-frame"
          title="Legal document"
          srcDoc={html}
          sandbox="allow-same-origin allow-popups"
          onLoad={handleIframeLoad}
        />
      ) : (
        <div className="legal-modal-msg">Loading…</div>
      )}
    </div>
  );
}
