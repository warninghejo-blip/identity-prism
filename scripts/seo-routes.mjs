/**
 * Canonical SEO inventory for the public web build.
 *
 * The prerendered copy below intentionally mirrors the logged-out React UI.
 * Keep it in sync when the corresponding page copy changes; serving materially
 * different text only to crawlers would be cloaking.
 */

export const SITE_ORIGIN = 'https://identityprism.xyz';
export const DEFAULT_IMAGE_PATH = '/textures/back.png';
export const DEFAULT_IMAGE = `${SITE_ORIGIN}${DEFAULT_IMAGE_PATH}`;
export const DEFAULT_IMAGE_WIDTH = 2752;
export const DEFAULT_IMAGE_HEIGHT = 1536;

export const localeAlternates = [
  { hreflang: 'en', href: `${SITE_ORIGIN}/` },
  { hreflang: 'ru', href: `${SITE_ORIGIN}/ru` },
  { hreflang: 'x-default', href: `${SITE_ORIGIN}/` },
];

const primaryLinks = [
  { href: '/', label: 'Identity Prism home' },
  { href: '/identity', label: 'Solana Identity Passport' },
  { href: '/blackhole', label: 'Black Hole wallet cleanup' },
  { href: '/sybil-check', label: 'Solana Sybil Checker' },
  { href: '/leaderboard', label: 'Identity Prism leaderboard' },
  { href: '/whitepaper.html', label: 'Identity Prism whitepaper' },
  { href: '/developers.html', label: 'Developer API documentation' },
  { href: '/ru', label: 'Identity Prism на русском' },
];

export const indexableSpaRoutes = [
  {
    path: '/',
    language: 'en',
    alternates: localeAlternates,
    title: 'Identity Prism — Sybil-Resistant Reputation & Identity on Solana',
    description:
      'Build a portable Solana wallet reputation profile from public chain data and server-verified application signals, then inspect any wallet’s sybil risk for free.',
    h1: 'Your reputation, earned not bought.',
    paragraphs: [
      'Identity Prism builds wallet reputation from public on-chain history, server-verified gameplay, and application activity while coordinated sybil behavior is surfaced for review.',
      'One portable profile combines planetary tiers, profile badges, and a sybil-risk score that Solana applications can use as an additional signal for airdrops, governance, communities, and access.',
    ],
    links: primaryLinks.filter((link) => link.href !== '/'),
    schema: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${SITE_ORIGIN}/#organization`,
          name: 'Identity Prism',
          url: `${SITE_ORIGIN}/`,
          logo: `${SITE_ORIGIN}/phav.png`,
          sameAs: [
            'https://x.com/Identity_Prism',
            'https://github.com/warninghejo-blip/identity-prism',
          ],
        },
        {
          '@type': 'WebSite',
          '@id': `${SITE_ORIGIN}/#website`,
          url: `${SITE_ORIGIN}/`,
          name: 'Identity Prism',
          description:
            'Wallet reputation and sybil-risk signals for Solana.',
          publisher: { '@id': `${SITE_ORIGIN}/#organization` },
        },
        {
          '@type': 'SoftwareApplication',
          name: 'Identity Prism',
          applicationCategory: 'FinanceApplication',
          operatingSystem: 'Web, Android',
          url: `${SITE_ORIGIN}/`,
          description:
            'A sybil-resistant identity and wallet reputation application for Solana.',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        },
      ],
    },
  },
  {
    path: '/ru',
    language: 'ru',
    alternates: localeAlternates,
    title: 'Solana Identity (Солана Идентити) — репутация кошелька | Identity Prism',
    description:
      'Identity Prism — Solana Identity на русском: паспорт репутации кошелька, бесплатная проверка sybil-риска и безопасная очистка токен-аккаунтов через Black Hole.',
    h1: 'Solana Identity — репутация кошелька в Identity Prism',
    paragraphs: [
      'Identity Prism превращает открытую историю Solana-кошелька в переносимый паспорт репутации. Он объединяет ончейн-активность, возраст кошелька, достижения, планетарный уровень и сигналы доверия в понятный составной рейтинг.',
      'Бесплатная проверка sybil-риска помогает изучить связи, источники финансирования и поведенческие паттерны любого публичного адреса Solana. Это аналитические сигналы, а не KYC, кредитный рейтинг или гарантия личности владельца.',
      'Black Hole помогает вручную проверить пыль и ненужные токен-аккаунты, защитить значимые активы и вернуть доступную SOL-ренту. Ничего не перемещается автоматически: каждое действие подтверждает владелец кошелька.',
    ],
    links: [
      { href: '/identity', label: 'Открыть паспорт Solana Identity' },
      { href: '/sybil-check', label: 'Проверить Solana-кошелёк на sybil-риск' },
      { href: '/blackhole', label: 'Очистить пыль через Black Hole' },
      { href: '/whitepaper.html', label: 'Прочитать техническое описание' },
      { href: '/', label: 'English version' },
    ],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Solana Identity — Identity Prism на русском',
      url: `${SITE_ORIGIN}/ru`,
      inLanguage: 'ru',
      description:
        'Русскоязычный обзор Identity Prism: паспорт репутации Solana-кошелька, проверка sybil-риска и Black Hole.',
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
      about: {
        '@type': 'SoftwareApplication',
        name: 'Identity Prism',
        applicationCategory: 'FinanceApplication',
        operatingSystem: 'Web, Android',
      },
    },
  },
  {
    path: '/blackhole',
    language: 'en',
    title: 'Solana Black Hole — Reclaim SOL Rent & Burn Dust Safely | Identity Prism',
    description:
      'Scan your Solana token accounts and NFTs, protect high-signal assets, then burn or close worthless dust to reclaim the SOL rent locked inside. Identity Prism holders pay just 2% vs 10%.',
    h1: 'Black Hole',
    paragraphs: [
      'Recover rent from dust, swap what still has value, and keep protected assets untouched. Black Hole reviews Solana token accounts and NFTs before suggesting a cleanup path.',
      'Nothing moves automatically. Connect a wallet, review the proposed plan, and approve each cleanup transaction yourself. Identity Prism and other high-signal assets are excluded from automatic cleanup candidates.',
    ],
    links: [
      { href: '/identity', label: 'Protect assets with an Identity Passport' },
      { href: '/sybil-check', label: 'Check a Solana wallet for sybil risk' },
      { href: '/', label: 'Explore every Identity Prism module' },
      { href: '/whitepaper.html', label: 'Read how Identity Prism works' },
    ],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Identity Prism Black Hole',
      url: `${SITE_ORIGIN}/blackhole`,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Web, Android',
      description:
        'A non-custodial Solana wallet cleanup tool that reviews token accounts, protects high-signal assets, and helps users reclaim eligible account rent.',
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
      featureList: [
        'Review Solana token accounts and NFTs',
        'Protect high-signal assets',
        'Burn or close selected dust accounts',
        'Reclaim eligible SOL account rent',
      ],
    },
  },
  {
    path: '/identity',
    language: 'en',
    title: 'Your Solana Identity Passport — Wallet Reputation | Identity Prism',
    description:
      'Mint your Identity Prism passport as a wallet-owned Metaplex Core NFT. Its metadata records the tier, badges, and composite profile present at mint time.',
    h1: 'Identity Passport',
    paragraphs: [
      'Identity Prism reads public wallet activity and application signals to build an identity passport with a composite reputation score, planetary tier, badges, and sybil-risk indicators.',
      'Connect your wallet to view your live passport. The public home page includes a non-personal demo and tier preview, so no wallet is required to explore how the identity card works.',
    ],
    links: [
      { href: '/', label: 'See the Identity Passport demo' },
      { href: '/sybil-check', label: 'Run a free Solana sybil check' },
      { href: '/blackhole', label: 'Review Black Hole wallet cleanup' },
      { href: '/whitepaper.html', label: 'Read the identity protocol overview' },
    ],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Identity Prism Passport',
      url: `${SITE_ORIGIN}/identity`,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web, Android',
      description:
        'A wallet-owned Solana identity passport with reputation tiers, badges, and a composite score derived from public on-chain and server-recorded application signals.',
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
  },
  {
    path: '/sybil-check',
    language: 'en',
    title: 'Solana Sybil Checker — Free Wallet Sybil & Trust Analysis | Identity Prism',
    description:
      'Instantly check any Solana wallet for sybil risk. Composite trust score, cluster detection, funding-source analysis and behavioral signals — free, no signup.',
    h1: 'Scan any wallet. See the truth.',
    paragraphs: [
      'Paste a public Solana address and Identity Prism analyzes on-chain history, transfer relationships, funding sources, behavioral patterns, and cluster membership.',
      'The report combines trust and risk signals for investigation. Results are informational heuristics, not KYC, a credit rating, financial advice, or a guarantee about the wallet owner.',
    ],
    links: [
      { href: '/identity', label: 'Build a Solana Identity Passport' },
      { href: '/blackhole', label: 'Clean up token-account dust safely' },
      { href: '/developers.html', label: 'Integrate the wallet reputation API' },
      { href: '/whitepaper.html', label: 'Review the sybil-resistance design' },
    ],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Identity Prism Solana Sybil Checker',
      url: `${SITE_ORIGIN}/sybil-check`,
      applicationCategory: 'SecurityApplication',
      operatingSystem: 'Web',
      description:
        'A free public Solana wallet analysis tool for reviewing sybil risk, trust signals, transfer relationships, and funding patterns.',
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  },
  {
    path: '/leaderboard',
    language: 'en',
    title: 'Solana Reputation & Game Leaderboard | Identity Prism',
    description:
      'Explore the public Identity Prism leaderboard for overall reputation and skill-game rankings across the Solana identity ecosystem.',
    h1: 'Leaderboard',
    paragraphs: [
      'Explore top participants across the Identity Prism universe. The public leaderboard presents overall reputation and game-specific rankings reported by the live application.',
      'Rankings are informational and may change as new activity is processed. Visit the Identity Passport to understand tiers and badges, or use the Sybil Checker to review a public Solana wallet.',
    ],
    links: [
      { href: '/identity', label: 'Explore Identity Passport tiers and badges' },
      { href: '/sybil-check', label: 'Check a public Solana wallet' },
      { href: '/', label: 'Learn about Identity Prism reputation' },
      { href: '/whitepaper.html', label: 'Read the reputation model overview' },
    ],
    schema: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Identity Prism Leaderboard',
      url: `${SITE_ORIGIN}/leaderboard`,
      description:
        'Public overall reputation and skill-game rankings in the Identity Prism ecosystem.',
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    },
  },
];

export const noindexSpaRoutes = [
  '/app',
  '/demo',
  '/home',
  '/share',
  '/game',
  '/preview',
  '/verify',
  '/compare',
  '/forge',
  '/scan',
  '/arena',
  '/vault',
  '/quests',
  '/recovery',
  '/text-quest',
  '/inbox',
  '/profile',
];

export const NOINDEX_DESCRIPTION =
  'Interactive Identity Prism application route. Connect a wallet or use the public product pages to explore the Solana identity ecosystem.';

export function noindexTitle(pathname) {
  return `Identity Prism App — ${pathname.slice(1).replaceAll('-', ' ')}`;
}

export function matchNoindexRoute(pathname) {
  return noindexSpaRoutes.find(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function noindexArtifactPath(pathname) {
  return pathname === '/profile'
    ? '_spa-noindex/profile.html'
    : `${pathname.slice(1)}/index.html`;
}

export const routeRedirects = [
  { from: '/landing', to: '/', status: 301 },
  { from: '/sybil-hunt', to: '/sybil-check', status: 301 },
  { from: '/market', to: '/arena', status: 301 },
  { from: '/constellation', to: '/scan', status: 301 },
  { from: '/scam-checker', to: '/scan', status: 301 },
];

export const staticPageSeo = [
  {
    path: '/whitepaper.html',
    title: 'Solana Identity & Sybil Resistance Whitepaper | Identity Prism',
    description:
      'Read the Identity Prism overview: portable Solana wallet reputation, composite scoring, planetary tiers, badges, skill games, and sybil-resistance signals.',
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    ogType: 'article',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Identity Prism Whitepaper',
      url: `${SITE_ORIGIN}/whitepaper.html`,
      description:
        'An overview of Identity Prism portable Solana wallet reputation, scoring, tiers, badges, games, and sybil-resistance signals.',
      publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    },
  },
  {
    path: '/developers.html',
    title: 'Solana Wallet Reputation API Documentation | Identity Prism',
    description:
      'Integrate Identity Prism public Solana wallet reputation and sybil-analysis endpoints. Review the beta API, response fields, examples, and operating limits.',
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    ogType: 'article',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Identity Prism Solana Wallet Reputation API Documentation',
      url: `${SITE_ORIGIN}/developers.html`,
      description:
        'Public beta API documentation for Identity Prism Solana wallet reputation and sybil-analysis endpoints.',
      publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    },
  },
  {
    path: '/brand.html',
    title: 'Identity Prism Brand Assets & Guidelines',
    description:
      'Official Identity Prism logos, colors, typography, naming, and usage guidance for press, ecosystem partners, and community media.',
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Identity Prism Brand Assets',
      url: `${SITE_ORIGIN}/brand.html`,
      description:
        'Official Identity Prism logos, colors, typography, naming, and usage guidance.',
    },
  },
  {
    path: '/privacy.html',
    title: 'Privacy Policy | Identity Prism',
    description:
      'How Identity Prism handles public wallet data, gameplay records, local storage, service providers, retention, and privacy choices.',
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Identity Prism Privacy Policy',
      url: `${SITE_ORIGIN}/privacy.html`,
    },
  },
  {
    path: '/terms.html',
    title: 'Terms of Use | Identity Prism',
    description:
      'Terms governing use of Identity Prism, including wallet responsibilities, non-custodial transactions, scores, games, and experimental features.',
    robots: 'index, follow, max-image-preview:large, max-snippet:-1',
    schema: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Identity Prism Terms of Use',
      url: `${SITE_ORIGIN}/terms.html`,
    },
  },
  {
    path: '/agent-demo.html',
    title: 'Identity Prism Oracle Demo',
    description:
      'Interactive internal demonstration of the Identity Prism wallet reputation oracle.',
    robots: 'noindex, follow',
  },
  {
    path: '/cookies.html',
    title: 'Cookie Policy | Identity Prism',
    description:
      'Details about cookies and local browser storage used by Identity Prism.',
    robots: 'noindex, follow',
  },
  {
    path: '/copyright.html',
    title: 'Copyright Notice | Identity Prism',
    description: 'Copyright and intellectual-property notice for Identity Prism.',
    robots: 'noindex, follow',
  },
  {
    path: '/disclaimer.html',
    title: 'Disclaimer | Identity Prism',
    description:
      'Important limitations and risk disclosures for Identity Prism scores, blockchain data, and experimental software.',
    robots: 'noindex, follow',
  },
  {
    path: '/license.html',
    title: 'Software License | Identity Prism',
    description: 'Software license terms for Identity Prism.',
    robots: 'noindex, follow',
  },
];

export const sitemapPaths = [
  ...indexableSpaRoutes.map((route) => route.path),
  ...staticPageSeo
    .filter((page) => page.robots.startsWith('index'))
    .map((page) => page.path),
];

export function findIndexableRoute(pathname) {
  return indexableSpaRoutes.find((route) => route.path === pathname);
}
