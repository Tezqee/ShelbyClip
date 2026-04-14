import { Buffer } from 'buffer';
(window as any).Buffer = Buffer;

// PROFESSIONAL MODE: Suppress all native browser logs to keep the console completely pristine
if (typeof window !== 'undefined') {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  console.debug = () => {};
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AptosWalletAdapterProvider } from '@aptos-labs/wallet-adapter-react';
import AptosCoreProvider from './AptosCoreProvider';
import { ShelbyClientProvider } from '@shelby-protocol/react';
import { ShelbyClient } from '@shelby-protocol/sdk/browser';

const queryClient = new QueryClient();
const shelbyClient = new ShelbyClient({ 
  network: 'testnet' as any,
  apiKey: import.meta.env.VITE_SHELBY_API_KEY
});

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch() { /* Silent catch in production */ }
  render() {
    if (this.state.hasError) {
      if (import.meta.env.DEV) {
        return (
          <div style={{color:'white', padding:'20px'}}>
            <h2>Crash Detected (Dev Mode)</h2>
            <pre style={{color:'red'}}>{this.state.error?.toString()}</pre>
            <pre style={{color:'orange'}}>{this.state.error?.stack}</pre>
          </div>
        );
      }
      return (
        <div style={{color:'white', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100vh', textAlign:'center', gap:'1rem'}}>
          <h2 style={{fontSize:'2rem'}}>Something went wrong</h2>
          <p style={{opacity:0.7}}>Please refresh the page or try again later.</p>
          <button 
            onClick={() => window.location.reload()}
            className="btn-premium"
            style={{padding:'0.5rem 1.5rem'}}
          >
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ShelbyClientProvider client={shelbyClient}>
        <QueryClientProvider client={queryClient}>
          <AptosWalletAdapterProvider autoConnect={true}>
            <AptosCoreProvider>
              <App />
            </AptosCoreProvider>
          </AptosWalletAdapterProvider>
        </QueryClientProvider>
      </ShelbyClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
