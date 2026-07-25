import { useSeo } from './useSeo';
import { indexableSpaRoutes } from '../../scripts/seo-routes.mjs';

/**
 * Keeps hydrated metadata aligned with the raw post-build HTML generated from
 * the same route manifest.
 */
export function usePublicRouteSeo(path: string) {
  const route = indexableSpaRoutes.find((candidate) => candidate.path === path);
  if (!route) {
    throw new Error(`Missing public SEO route manifest entry for ${path}`);
  }

  useSeo({
    title: route.title,
    description: route.description,
    path: route.path,
    structuredData: route.schema,
  });
}
