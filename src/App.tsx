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

  const handleConnect = () => {
    if (wallets && wallets[0]) {
      connect(wallets[0].name);
    }
  };

  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        
        <div className="topbar">
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
