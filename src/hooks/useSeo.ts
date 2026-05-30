import { useEffect } from 'react';

/**
 * useSeo — per-route SEO without SSR. Updates document.title + the SEO meta tags
 * (description, canonical, Open Graph, Twitter card) on mount/route change so each
 * page exposes unique, keyword-rich metadata to crawlers and social unfurlers.
 */
export interface SeoOptions {
  title: string;
  description: string;
  /** Absolute path, e.g. "/sybil-check". Defaults to the current pathname. */
  path?: string;
  image?: string;
  /** Set to true on auth-gated / thin pages we don't want indexed. */
  noindex?: boolean;
}

const SITE = 'https://identityprism.xyz';
const DEFAULT_IMAGE = `${SITE}/og-image.png`;

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useSeo({ title, description, path, image, noindex }: SeoOptions) {
  useEffect(() => {
    const pathname = path ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
    const url = `${SITE}${pathname}`;
    const img = image || DEFAULT_IMAGE;

    document.title = title;
    upsertMeta('name', 'description', description);
    upsertLink('canonical', url);
    upsertMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1');

    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', url);
    upsertMeta('property', 'og:image', img);

    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', img);
  }, [title, description, path, image, noindex]);
}
