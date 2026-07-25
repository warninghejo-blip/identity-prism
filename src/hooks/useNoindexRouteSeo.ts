import { useSeo } from './useSeo';
import {
  NOINDEX_DESCRIPTION,
  matchNoindexRoute,
  noindexTitle,
} from '../../scripts/seo-routes.mjs';

/**
 * Prevents an indexable route's metadata from leaking into wallet-, account-,
 * or interaction-specific routes during client-side navigation.
 */
export function useNoindexRouteSeo(pathname: string) {
  const canonicalPath = matchNoindexRoute(pathname);
  useSeo({
    title: noindexTitle(canonicalPath ?? '/app'),
    description: NOINDEX_DESCRIPTION,
    path: canonicalPath ?? pathname,
    noindex: true,
    enabled: Boolean(canonicalPath),
    structuredData: null,
  });
}
