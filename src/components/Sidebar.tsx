import { NavLink, Link } from 'react-router-dom';
import { Home, PlusSquare, User, Users, Check, Loader2 } from 'lucide-react';
import { useShelbyClient } from '@shelby-protocol/react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useEffect, useState, useCallback } from 'react';
import NotificationsPanel from './NotificationsPanel';
import { checkBlobExists, getFollowBlobName, toggleFollow as socialToggleFollow, fetchProfile, normalizeAddr } from '../services/social';






export default function Sidebar() {
  const shelbyClient = useShelbyClient();
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const uploadBlobs = useUploadBlobs({});
  
  const myAddr = useMemo(() => normalizeAddr(account?.address.toString() || ''), [account?.address]);

  // Auto-discovery of active creators using the dApp
  const { data: globalBlobs } = useQuery({
    queryKey: ['discovery-creators'],
    queryFn: async () => {
      return await shelbyClient.coordination.getBlobs({
        where: { blob_name: { _ilike: "%shelby-clip/%:::%" } },
        pagination: { limit: 100 }
      });
    },
    refetchInterval: 120000,
  });

  const creators = useMemo(() => {
    if (!globalBlobs) return [];
    const blobList = Array.isArray(globalBlobs)
      ? globalBlobs
      : (globalBlobs as any).blobs || (globalBlobs as any).hits || [];

    const uniqueOwners = new Set<string>();
    blobList.forEach((b: any) => {
      const fullBlobName = b.blob_name || b.blobNameSuffix || b.name || "";
      let owner = (b.owner || b.address || b.owner_address || "0x0").toString();
      
      if (fullBlobName.startsWith('@')) {
        owner = fullBlobName.substring(1).split('/')[0];
      }
      
      const norm = normalizeAddr(owner);
      if (norm && norm !== '0x0000000000000000000000000000000000000000000000000000000000000000' && norm !== myAddr) {
        uniqueOwners.add(norm);
      }
    });

    return Array.from(uniqueOwners).slice(0, 5);
  }, [globalBlobs, myAddr]);

  return (
    <div className="sidebar">
      <div className="flex flex-col items-center gap-2 flex-1 w-full pt-8">
        <NavLink to="/" className={({ isActive }) => `nav-button ${isActive ? 'active' : ''}`} title="Home">
          <Home size={26} />
          <span>Home</span>
        </NavLink>

        <NavLink to="/upload" className={({ isActive }) => `nav-button ${isActive ? 'active' : ''}`} title="Post">
          <PlusSquare size={26} />
          <span>Post</span>
        </NavLink>

        <NavLink to="/profile" className={({ isActive }) => `nav-button ${isActive ? 'active' : ''}`} title="Profile">
          <User size={26} />
          <span>Profile</span>
        </NavLink>

        {/* Notifications */}
        <NotificationsPanel />

        {/* Suggested Creators Section */}
        {creators.length > 0 && (
          <div className="creators-section mt-8 w-full">
            <div className="px-4 mb-4 flex items-center gap-2 opacity-40">
              <Users size={14} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Suggested</span>
            </div>
            
            <div className="flex flex-col gap-3 px-2">
              {creators.map((addr) => (
                <CreatorItem
                  key={addr}
                  addr={addr}
                  myAddr={myAddr}
                  shelbyClient={shelbyClient}
                  connected={connected}
                  account={account}
                  signAndSubmitTransaction={signAndSubmitTransaction}
                  uploadBlobs={uploadBlobs}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreatorItem({ 
  addr, myAddr, shelbyClient, connected, account, signAndSubmitTransaction, uploadBlobs 
}: {
  addr: string,
  myAddr: string,
  shelbyClient: any,
  connected: boolean,
  account: any,
  signAndSubmitTransaction: any,
  uploadBlobs: any
}) {

  const [following, setFollowing] = useState(false);
  const [loadingFollow, setLoadingFollow] = useState(false);

  const { data: p } = useQuery({
    queryKey: ['profile', addr],
    queryFn: () => fetchProfile(shelbyClient, addr),
    staleTime: 10000,
  });

  useEffect(() => {
    if (connected && account) {
      checkBlobExists(myAddr, getFollowBlobName(addr)).then(setFollowing);
    }
  }, [addr, connected, account, myAddr]);

  const handleFollow = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!connected || !account || !signAndSubmitTransaction || loadingFollow) return;
    setLoadingFollow(true);
    const prev = following;
    try {
      await socialToggleFollow(prev, addr, account, signAndSubmitTransaction, uploadBlobs);
      setFollowing(!prev);
    } catch {
      // Ignore follow errors
    } finally { setLoadingFollow(false); }
  }, [following, loadingFollow, connected, account, signAndSubmitTransaction, uploadBlobs, addr]);

  const displayName = p?.displayName || '';
  const avatarUrl = p?.avatarUrl || null;
  const initials = displayName
    ? displayName[0].toUpperCase()
    : addr.substring(addr.length - 2).toUpperCase();
  const label = displayName
    ? displayName
    : `@${addr.substring(2, 6)}...`;

  return (
    <Link to={`/profile/${addr}`} className="creator-item-mini" title={displayName || addr}>
      <div className="creator-avatar-mini" style={{ overflow: 'hidden', padding: 0 }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName || addr} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : initials}
        {connected && myAddr !== addr && (
          <button
            className={`avatar-follow-btn${following ? ' avatar-follow-btn--active' : ''}`}
            onClick={handleFollow}
            disabled={loadingFollow}
          >
            {loadingFollow ? <Loader2 size={9} className="animate-spin" /> : (following ? <Check size={9} strokeWidth={3} /> : '+')}
          </button>
        )}
      </div>
      <div className="creator-info-mini">
        <span className="creator-name-mini">{label}</span>
        {following && <span style={{ fontSize: '0.65rem', opacity: 0.5 }}>Following</span>}
      </div>
    </Link>
  );
}
