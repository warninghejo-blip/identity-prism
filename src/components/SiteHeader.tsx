import { Link, NavLink } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { useBlackHolePrefetch } from '@/hooks/useBlackHolePrefetch';
import WebWalletButton from './WebWalletButton';
import './SiteHeader.css';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/identity', label: 'Identity' },
  { to: '/blackhole', label: 'Black Hole' },
  { to: '/sybil-check', label: 'Sybil Check' },
];

export default function SiteHeader() {
  const { publicKey } = useWallet();
  useBlackHolePrefetch(publicKey ?? null);

  return (
    <header className="site-header">
      <Link to="/" className="site-header__brand" aria-label="Identity Prism home">
        <img src="/phav.png" alt="" />
        <span>IDENTITY PRISM</span>
      </Link>
      <nav className="site-header__nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="site-header__wallet">
        <WebWalletButton />
      </div>
    </header>
  );
}
