import { Link } from 'react-router-dom';
import SiteHeader from '@/components/SiteHeader';
import { usePublicRouteSeo } from '@/hooks/usePublicRouteSeo';
import { indexableSpaRoutes } from '../../scripts/seo-routes.mjs';
import './russian-landing.css';

const route = indexableSpaRoutes.find((candidate) => candidate.path === '/ru');

if (!route) {
  throw new Error('Missing Russian SEO route manifest entry');
}

export default function RussianLandingPage() {
  usePublicRouteSeo('/ru');

  return (
    <div className="ru-landing">
      <SiteHeader />
      <main className="ru-landing__main">
        <p className="ru-landing__eyebrow">IDENTITY PRISM · SOLANA</p>
        <h1>{route.h1}</h1>
        <p className="ru-landing__lead">
          Solana Identity (Солана Идентити) без KYC: публичная ончейн-репутация,
          проверка sybil-риска и инструменты для безопасной работы с кошельком.
        </p>

        <section className="ru-landing__grid" aria-label="Возможности Identity Prism">
          {route.paragraphs.map((paragraph, index) => (
            <article key={paragraph}>
              <span>0{index + 1}</span>
              <p>{paragraph}</p>
            </article>
          ))}
        </section>

        <nav className="ru-landing__links" aria-label="Разделы Identity Prism">
          {route.links.map((link) => (
            <Link key={link.href} to={link.href}>{link.label}</Link>
          ))}
        </nav>
      </main>
    </div>
  );
}
