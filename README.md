# ⚡ Shelby Clip

A high-performance, decentralized vertical video platform built on the **Shelby Network**. Experience an immersive vertical video social feed powered by blockchain security and decentralized storage.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Network](https://img.shields.io/badge/Network-Shelby_Testnet-orange.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

## 🌟 Features

- **Immersive Video Feed**: Smooth vertical scrolling with snap-to-center mechanics.
- **Premium Vertical UI**: Mobile-first design with a hidden sidebar and bottom navigation for smaller screens.
- **Real-time Notifications**: Instant alerts for likes, comments, reposts, and follows.
- **Direct-Fetch Profiles**: Instant profile visibility bypassing indexer latency using static path resolution.
- **Premium UX**: Double-tap to like, immersive header, and auto-play audio management.
- **Production Ready**: Global log management to protect technical data and optimized performance.

## 🚀 Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Styling**: Vanilla CSS (Premium Glassmorphism Design)
- **Blockchain**: Shelby SDK (Coordination & Storage)
- **State Management**: React Query (TanStack)
- **Auth**: Aptos Wallet Adapter (Connect with Petra, Pontem, etc.)
- **Icons**: Lucide React

## 📦 Getting Started

### Prerequisites

- Node.js (v18+)
- npm or yarn
- An Aptos-compatible wallet (Testnet configured)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Tezqee/ShelbyClip.git
   cd ShelbyClip
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment:
   Create a `.env` file based on `.env.example`:
   ```env
   VITE_SHELBY_RPC_URL=your_rpc_url
   ```

4. Run development server:
   ```bash
   npm run dev
   ```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
Built with ⚡ by **Tezqee**
