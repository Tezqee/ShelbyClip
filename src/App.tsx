import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import BottomNav from './components/BottomNav';
import Feed from './components/Feed';
import Upload from './components/Upload';
import Profile from './components/Profile';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { LogOut } from 'lucide-react';

function App() {
  const { connected, connect, disconnect, wallets, account } = useWallet();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const handleConnect = () => {
    if (wallets && wallets[0]) {
      connect(wallets[0].name);
    }
  };

  return (
    <BrowserRouter>
      {showSplash && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'var(--background)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'splashFadeOut 0.5s ease-out 2s forwards'
        }}>
          <div className="sidebar-logo" style={{ width: '80px', height: '80px', borderRadius: '20px', marginBottom: '1.5rem', animation: 'scaleUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', border: '1px solid rgba(255,255,255,0.1)' }}>
            <svg viewBox="0 0 76 65" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="white"/>
            </svg>
          </div>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.05em', color: 'white', opacity: 0, animation: 'fadeIn 0.5s ease-out 0.4s forwards' }}>
            Shelby Clip
          </h1>
        </div>
      )}

      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        
        <div className="topbar">
          <div className="topbar-logo-container" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', pointerEvents: 'auto' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', border: '1px solid rgba(255,255,255,0.1)' }}>
              <svg viewBox="0 0 76 65" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="white"/>
              </svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'white' }}>SHELBY</span>
              <span className="shelby-badge">CLIP</span>
            </div>
          </div>

          <div className="topbar-actions" style={{ display: 'flex', gap: '1rem', pointerEvents: 'auto' }}>
            {!connected ? (
              <button className="btn-primary" onClick={handleConnect}>Connect Wallet</button>
            ) : (
              <button 
                onClick={() => disconnect()}
                title="Disconnect Wallet"
                className="flex items-center gap-2 transition-all hover:bg-neutral-800" 
                style={{ 
                   background: 'var(--sidebar)', 
                   padding: '0.5rem 1rem', 
                   borderRadius: '2rem',
                   border: '1px solid rgba(255,255,255,0.1)',
                   color: 'white',
                   cursor: 'pointer'
                }}>
                <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                  {account?.address?.toString().substring(0,6)}...{account?.address?.toString().substring(account.address.toString().length - 4)}
                </span>
                <LogOut size={14} style={{ opacity: 0.6 }} />
              </button>
            )}
          </div>
        </div>

        <main className="flex-1 flex flex-col overflow-hidden relative">
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/profile/:address?" element={<Profile />} />
          </Routes>
        </main>

        <BottomNav />
      </div>
    </BrowserRouter>
  );
}
export default App;
