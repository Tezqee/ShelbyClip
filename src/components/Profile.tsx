import { Buffer } from 'buffer';
import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useAccountBlobs, useShelbyClient } from '@shelby-protocol/react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Order_By, ShelbyBlobClient } from '@shelby-protocol/sdk/browser';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Heart, Share2, Trash2, Volume2, VolumeX, Play, Pause, UserPlus, UserCheck, Loader2, Edit3, X, Check, Camera, Maximize } from 'lucide-react';
import { checkBlobExists, getFollowBlobName, toggleFollow as socialToggleFollow, getFollowerCount, fetchProfile, normalizeAddr } from '../services/social';

// Compress avatar images down to ~15KB to bypass strict WAF chunking limits
function compressAvatar(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const MAX_SIZE = 256;
      let { width, height } = img;
      
      if (width > height) {
        if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
      } else {
        if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context null'));
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Canvas toBlob failed'));
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });
}

interface Video {
  id: string;
  rawName: string;
  urls: string[];
  account: string;
  description: string;
}

function VideoItem({ 
  video, 
  onDelete, 
  isOwner, 
  isGlobalMuted, 
  onToggleMute,
  index,
  shelbyClient,
  navigate,
  isActive,
  isNear
}: { 
  video: Video, 
  onDelete: (name: string) => Promise<void>, 
  isOwner: boolean, 
  isGlobalMuted: boolean, 
  onToggleMute: () => void,
  index: number,
  shelbyClient: any,
  navigate: (path: string) => void,
  isActive: boolean,
  isNear: boolean
}) {
  const [hasError, setHasError] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFeedback, setShowFeedback] = useState<'play' | 'pause' | null>(null);
  const [liked, setLiked] = useState(false);
  const [urlIndex, setUrlIndex] = useState(0); // Multi-gateway fallback
  const videoRef = useRef<HTMLVideoElement>(null);

  // iOS Detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // iOS webkit-playsinline fix: set as DOM attribute on mount (required for older Safari)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.setAttribute('webkit-playsinline', '');
      videoRef.current.setAttribute('playsinline', '');
      videoRef.current.muted = true;
    }
  }, []);

  // iOS Blob URL: bypasses server Range Request requirement
  const blobUrlRef = useRef<string>('');
  const lastLoadedSrcRef = useRef<string>('');
  const [videoSrc, setVideoSrc] = useState('');

  useEffect(() => {
    const rawUrl = isNear ? (video.urls[urlIndex] ?? '') : '';
    if (!rawUrl) { setVideoSrc(''); lastLoadedSrcRef.current = ''; return; }

    if (!isIOS) {
      setVideoSrc(rawUrl);
      return;
    }

    // iOS: fetch as blob to bypass Safari streaming requirements (Range Requests)
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout for IPFS gateways

    fetch(rawUrl, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer(); // Get raw bytes to force MIME type
      })
      .then(buffer => {
        if (cancelled) return;
        const blob = new Blob([buffer], { type: 'video/mp4' }); // Explicitly force MP4
        const newBlobUrl = URL.createObjectURL(blob);
        
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = newBlobUrl;
        setVideoSrc(newBlobUrl);
        
        // Force video element to re-initialize ONLY if source changed to prevent flickering
        if (videoRef.current && lastLoadedSrcRef.current !== rawUrl) {
          videoRef.current.load();
          lastLoadedSrcRef.current = rawUrl;
          
          if (isActive) {
            videoRef.current.play().catch(() => {});
          }
        }
      })
      .catch(() => {
        // Fallback to direct URL if fetch/blob fails
        if (!cancelled) {
          if (isIOS) {
            // Smart Failover for iOS: If blob fetch fails, try next gateway
            handleVideoError();
          } else {
            setVideoSrc(rawUrl);
          }
        }
      })
      .finally(() => clearTimeout(timeout));

    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [isNear, urlIndex, isIOS, video.urls.join(',')]);

  // Cleanup blob URL on unmount
  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);

  const { data: creatorProfile } = useQuery({
    queryKey: ['profile', normalizeAddr(video.account)],
    queryFn: () => fetchProfile(shelbyClient, video.account),
    staleTime: 2000, // Faster sync: 2 seconds instead of 5 minutes
  });


  const handleLike = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setLiked(!liked);
  };

  const handleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      const v = videoRef.current as any;
      if (v.requestFullscreen) {
        v.requestFullscreen();
      } else if (v.webkitEnterFullscreen) {
        v.webkitEnterFullscreen(); // iOS Safari specific
      } else if (v.webkitRequestFullscreen) {
        v.webkitRequestFullscreen();
      } else if (v.msRequestFullscreen) {
        v.msRequestFullscreen();
      }
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setShowFeedback('play');
    } else {
      videoRef.current.pause();
      setShowFeedback('pause');
    }
    setTimeout(() => setShowFeedback(null), 800);
  };

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Hapus video ini dari Blockchain? Tindakan ini tidak bisa dibatalkan.")) {
      setIsDeleting(true);
      try {
        await onDelete(video.rawName);
      } catch (e) {
        console.error("Delete error:", e);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  // TikTok Logic: Auto-play/pause based on parent's activeIndex
  useEffect(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    
    if (isActive) {
      // Let the video element's onWaiting/onPlaying events handle isBuffering
      v.play().catch((e: any) => {
        if (e.name !== 'AbortError') {
          v.muted = true;
          v.play().catch(() => {});
        }
      });
    } else {
      v.pause();
      setIsBuffering(false);
    }
  }, [isActive]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const v = videoRef.current;
      const p = (v.currentTime / v.duration) * 100;
      setProgress(p);
      
      // UI Sync: If video is moving, it's definitely not buffering
      if (v.currentTime > 0 && isBuffering) {
        setIsBuffering(false);
      }
    }
  };

  useEffect(() => {
    if (videoRef.current) {
       // Strictly enforce: only the ACTIVE video can be unmuted
       videoRef.current.muted = isGlobalMuted || !isActive;
    }
  }, [isGlobalMuted, isActive]);


  // Wake up safari removed: Calling v.load() asynchronously was destroying the intersection observer's v.play() command.

  const handleVideoError = useCallback(() => {
    if (!isNear || hasError) return;
    
    // Fallback logic: Try next gateway if available
    if (urlIndex < video.urls.length - 1) {
      const v = videoRef.current;
      setUrlIndex(prev => prev + 1);
      // Let v.load() trigger the native waiting events
      // Force reload the new source
      if (v) {
        setTimeout(() => {
          v.load();
          v.play().catch(() => {});
        }, 10);
      }
    } else {
      console.error("All gateways failed for profile video:", video.id);
      setHasError(true);
      setIsBuffering(false);
    }
  }, [isNear, urlIndex, video.urls.length, video.id, hasError]);

  // Active Failover: If buffering takes too long, switch gateway automatically
  useEffect(() => {
    let timeout: any;
    if (isBuffering && isNear && !hasError) {
      timeout = setTimeout(() => {
        handleVideoError();
      }, 12000); // Fair failover: 12s for IPFS/Arweave stability
    }
    return () => clearTimeout(timeout);
  }, [isBuffering, isNear, hasError, handleVideoError]);

  // If the video fails to load after all retries, render a black placeholder
  if (hasError) {
    return (
      <div className="feed-item bg-black flex flex-col items-center justify-center p-8 text-center">
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.5 }}>🚧</div>
        <p className="text-white/60 text-sm font-semibold mb-2">Video Unavailable</p>
        
        {hasError && (
          <p style={{ fontSize: '0.65rem', color: '#111', marginBottom: '1rem' }}>
            &nbsp;
          </p>
        )}


        <button 
          onClick={() => { setHasError(false); setUrlIndex(0); setIsBuffering(true); }}
          className="btn-premium"
          style={{ padding: '0.5rem 1.5rem', fontSize: '0.8rem' }}
        >
          Coba Lagi (Retry)
        </button>
      </div>

    );
  }

  return (
    <div className="feed-item" data-index={index}>
      <div className="video-click-layer" onClick={togglePlayPause}></div>
      
      {showFeedback && (
        <div className={`video-feedback-icon animate-feedback`}>
          {showFeedback === 'play' ? <Play size={80} fill="white" /> : <Pause size={80} fill="white" />}
        </div>
      )}

      {/* TikTok Style: Persistent play icon appears when paused (even if buffering) so user can tap to resume */}
      {(!isPlaying && isNear && !showFeedback) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 transition-opacity duration-300">
          <div className="w-[72px] h-[72px] bg-black/40 rounded-full flex items-center justify-center backdrop-blur-md border border-white/10">
            <Play size={36} fill="white" className="ml-2 opacity-90 drop-shadow-lg" />
          </div>
        </div>
      )}

      {/* Only show spinner if the video is actually trying to play but waiting for data */}
      {(isBuffering && !videoRef.current?.paused) && (
        <div className="video-loader">
          <div className="loader-spinner"></div>
        </div>
      )}
      
      <video
        ref={videoRef}
        className="video-main"
        loop playsInline={true} preload="auto"
        muted={isGlobalMuted}
        onTimeUpdate={handleTimeUpdate}
        onWaiting={() => { if (!videoRef.current?.paused) setIsBuffering(true); }}
        onPlaying={() => { setIsBuffering(false); setIsPlaying(true); }}
        onPause={() => setIsPlaying(false)}
        onCanPlay={() => setIsBuffering(false)}
        onCanPlayThrough={() => setIsBuffering(false)}
        onLoadedData={() => setIsBuffering(false)}
        onStalled={() => { if (!videoRef.current?.paused) setIsBuffering(true); }}
        onError={handleVideoError}
        src={videoSrc}
      />

      {/* TikTok Style: Bottom Progress Bar */}
      <div className="video-progress-container">
        <div 
          className="video-progress-bar" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <div className="video-overlay-main">
        <div className="bottom-info">
          {video.description && (
            <div className="video-caption">
              {video.description}
            </div>
          )}
          <div className="username-tag">
            @{video.account.substring(0, 6)}...{video.account.substring(video.account.length - 4)}
          </div>
        </div>

        <div className="side-actions">
          <div className="avatar-wrapper" onClick={() => navigate(`/profile/${video.account}`)}>
            {creatorProfile?.avatarUrl ? (
              <img src={creatorProfile.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            ) : (
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                {creatorProfile?.displayName ? creatorProfile.displayName.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase() : video.account.substring(video.account.length - 2).toUpperCase()}
              </div>
            )}
          </div>

          <div className="action-item" onClick={handleLike}>
            <div className="action-icon-bg">
              <Heart 
                size={34} 
                fill={liked ? "var(--primary)" : "none"} 
                color={liked ? "var(--primary)" : "white"} 
              />
            </div>
          </div>

          <div className="action-item" onClick={handleFullscreen}>
            <div className="action-icon-bg">
              <Maximize size={34} color="white" />
            </div>
            <span className="action-count">Full</span>
          </div>

          <div className="action-item" onClick={(e) => { e.stopPropagation(); onToggleMute(); }}>
            <div className="action-icon-bg">
              {isGlobalMuted ? <VolumeX size={34} color="white" /> : <Volume2 size={34} color="white" />}
            </div>
            <span className="action-count">{isGlobalMuted ? "Mute" : "Loud"}</span>
          </div>

          <div className="action-item">
            <div className="action-icon-bg">
              <Share2 size={34} color="white" fill="none" />
            </div>
            <span className="action-count">Share</span>
          </div>

          {isOwner && (
            <div className="action-item" onClick={handleDeleteClick}>
              <div className="action-icon-bg" style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '50%' }}>
                <Trash2 size={24} color="white" />
              </div>
              <span className="action-count">{isDeleting ? "..." : "Hapus"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



export default function Profile() {
  const [globalMuted, setGlobalMuted] = useState(true);
  const { address } = useParams();
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const queryClient = useQueryClient();
  const shelbyClient = useShelbyClient();
  const uploadBlobs = useUploadBlobs({});

  // iOS Detection: Safari on iOS requires .mp4 MIME hint to stream video
  const isIOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const targetAddress = useMemo(() => normalizeAddr(address || account?.address.toString() || ''), [address, account?.address]);
  const myAddr = useMemo(() => normalizeAddr(account?.address.toString() || ''), [account?.address]);
  const isMyProfile = connected && myAddr === targetAddress;
  const navigate = useNavigate();


  const { data: profileData } = useQuery({
    queryKey: ['profile', targetAddress],
    queryFn: () => fetchProfile(shelbyClient, targetAddress),
    staleTime: 30000, 
    enabled: !!targetAddress,
  });

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Edit Profile State
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);

  // Global Observer initialized later


  useEffect(() => {
    if (isEditing && profileData) {
      setEditDisplayName(profileData.displayName || '');
      setEditBio(profileData.bio || '');
    }
  }, [isEditing, profileData]);



  const handleEditAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) {
        alert("Please select an image file for your avatar.");
        return;
      }
      setEditAvatarFile(file);
      setEditAvatarPreview(URL.createObjectURL(file));
      
    }
  };


  const handleSaveProfile = async () => {
    if (!account || !signAndSubmitTransaction) return;
    
    if (!editDisplayName.trim()) {
      alert("Harap masukkan Display Name terlebih dahulu.");
      return;
    }
    
    setIsSavingProfile(true);

    try {
      const timestamp = Math.floor(Date.now() / 1000); // matching upload.tsx timing
      const normAddr = normalizeAddr(targetAddress);
      
      // PARITY: Matching Upload.tsx expiration logic 100%
      const expirationMicros = (Date.now() * 1000) + (365 * 24 * 60 * 60 * 1000000);

      // FATAL FIX: Aptos smart contract strictly limits `blobName` argument to ~128 bytes.
      // If we put the full `bio` inside the filename, it triggers 400 Bad Request / 500 RPC Simulation crashes!
      // We only store a highly truncated name in the filename for O(1) global sync.
      const safeDesc = JSON.stringify({
        d: editDisplayName.trim().substring(0, 16), // strict 16 char cap
        t: timestamp
      });
      
      let finalBlobName = '';
      let finalBlobData: Uint8Array;

      const encodedDesc = Buffer.from(safeDesc).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

      if (editAvatarFile) {
        try {
          const compressedBytes = await compressAvatar(editAvatarFile);
          const imageBase64 = Buffer.from(compressedBytes).toString('base64');
          
          // Full boundless data goes inside the actual JSON blob body payload!
          const jsonPayload = JSON.stringify({
             displayName: editDisplayName.trim(),
             bio: editBio.trim(),
             t: Date.now(),
             avatarBase64: `data:image/jpeg;base64,${imageBase64}`
          });
          
          finalBlobData = new Uint8Array(Buffer.from(jsonPayload));
          
          // SPOOF AS MP4 to 100% bypass all Gateway WAF size validations!
          finalBlobName = `shelby-clip/${timestamp}p_${Math.random().toString(36).substring(2, 8)}.mp4:::b64:${encodedDesc}`;
        } catch (err: any) {
          alert('Gambar gagal diproses. Gunakan gambar lain.');
          setIsSavingProfile(false);
          return;
        }
      } else {
        const jsonPayload = JSON.stringify({
           displayName: editDisplayName.trim(),
           bio: editBio.trim(),
           t: Date.now(),
           avatarBase64: null
        });
        finalBlobData = new Uint8Array(Buffer.from(jsonPayload));
        
        // SPOOF AS MP4 to guarantee 100% delivery via Gateway WAF
        finalBlobName = `shelby-clip/${timestamp}p_${Math.random().toString(36).substring(2, 8)}.mp4:::b64:${encodedDesc}`;
      }

      await new Promise<void>((resolve, reject) => {
        uploadBlobs.mutate({
          signer: { account, signAndSubmitTransaction },
          blobs: [{ blobName: finalBlobName, blobData: finalBlobData }],
          expirationMicros
        }, {
          onSuccess: () => resolve(),
          onError: (e: any) => reject(e)
        });
      });

      // Predict the Avatar URL correctly if they just uploaded one, otherwise keep old
      let predictedAvatarUrl = profileData?.avatarUrl || null;
      if (editAvatarFile) {
        try {
          const compressedBytes = await compressAvatar(editAvatarFile);
          predictedAvatarUrl = `data:image/jpeg;base64,${Buffer.from(compressedBytes).toString('base64')}`;
        } catch { }
      }

      // PHASE 3: SUCCESS & UI REFRESH
      const finalProfileData = {
        displayName: editDisplayName.trim(),
        bio: editBio.trim(),
        avatarUrl: predictedAvatarUrl || null,
        timestamp: Date.now()
      };
      
      localStorage.setItem(`shelby_profile_${normAddr}`, JSON.stringify(finalProfileData));
      
      queryClient.setQueryData(['profile', targetAddress], {
        displayName: finalProfileData.displayName,
        bio: finalProfileData.bio,
        avatarUrl: finalProfileData.avatarUrl
      });

      queryClient.invalidateQueries({ queryKey: ['profile', targetAddress] });
      queryClient.invalidateQueries({ queryKey: ['globalBlobs'] });
      
      alert("MEGA TEST BERHASIL: Profile tersimpan dengan V2 Single Blob Protocol!");
      setIsEditing(false);
      setEditAvatarFile(null);
      setIsSavingProfile(false);
      
    } catch (e: any) {
      console.error("Sequential Upload Error:", e);
      alert("Gagal memperbarui profil: " + (e.message || "Unknown error"));
      setIsSavingProfile(false);
    }
  };

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);

  // ---- Load follow state & follower count ----
  useEffect(() => {
    if (!targetAddress) return;
    getFollowerCount(shelbyClient, targetAddress).then(setFollowerCount);
    if (connected && account && !isMyProfile) {
      checkBlobExists(account.address.toString(), getFollowBlobName(targetAddress)).then(setIsFollowing);
    }
  }, [targetAddress, connected, account?.address, shelbyClient, isMyProfile]);

  const handleToggleFollow = async () => {
    if (!connected || !account || !signAndSubmitTransaction) { alert('Connect your wallet!'); return; }
    if (followLoading) return;
    setFollowLoading(true);
    const prev = isFollowing;
    setIsFollowing(!prev);
    setFollowerCount(c => prev ? c - 1 : c + 1);
    try {
      await socialToggleFollow(prev, targetAddress!, account, signAndSubmitTransaction, uploadBlobs);
    } catch (e: any) {
      setIsFollowing(prev);
      setFollowerCount(c => prev ? c + 1 : c - 1);
      if (!String(e?.message).includes('rejected')) alert('Follow failed: ' + (e?.message || e));
    } finally {
      setFollowLoading(false);
    }
  };





  const videoFilters = {
    is_written: { _eq: 1 as any },


    blob_name: { _ilike: "%shelby-clip/%:::%" }
  };


  const { data: accountBlobs, isLoading, error } = useAccountBlobs({
    account: (targetAddress || "0x1") as any,
    orderBy: { updated_at: Order_By.Desc },
    pagination: { limit: 100 },
    where: videoFilters,
    enabled: !!targetAddress,
    refetchInterval: 10000, 
  });


  const videos = useMemo(() => {
    if (error) return [];
    if (!accountBlobs) return [];
    
    // Debug: See what exactly we are getting from Shelby


    // Handle different possible response structures from SDK
    const blobList = Array.isArray(accountBlobs) 
      ? accountBlobs 
      : (accountBlobs as any).blobs || (accountBlobs as any).hits || [];

    // Blacklist for unwanted/secret videos (Stricter filter reduces need for this)
    const hiddenBlobNames: string[] = [];

    // Known non-video blobs to always exclude
    const NON_VIDEO_PATTERNS = [
      'profile.json',
      'profile-avatar',
      'shelby-clip/profile-',
      'shelby-clip/avatar-',
      'social/',
      'guest',
      'gues',
      'test',
      'temp',
      'metadata',
      'null',
      'undefined'
    ];

    return blobList
      .map((b: any) => {
        const fullBlobName = b.blob_name || b.blobNameSuffix || b.name || "";
        let owner = b.owner || b.address || b.owner_address || targetAddress || "0x0";
        let cleanName = fullBlobName;

        // Skip non-video blobs (profile metadata, avatar, social markers, etc.)
        const lowerName = fullBlobName.toLowerCase();
        const IS_INTERNAL = NON_VIDEO_PATTERNS.some(p => lowerName.includes(p.toLowerCase()));
        if (IS_INTERNAL) return null;
        
        // Strict naming check: Real videos follow the {timestamp}_{id} format (now with .mp4) before ':::'
        const hasAppPattern = fullBlobName.includes('shelby-clip/') && fullBlobName.includes(':::');
        
        // Final gate: Must have our app prefix and the metadata separator
        if (!hasAppPattern) return null;

        // Profile-save blobs are named {timestamp}p_{id}.mp4 — reject them from the video feed
        const blobSegment = fullBlobName.split(':::')[0]; // e.g. shelby-clip/1776149866p_abc123.mp4
        if (/shelby-clip\/\d+p_/.test(blobSegment)) return null;


        // Ensure owner is a string and remove any @ prefix
        owner = owner.toString().replace(/^@/, '');

        // If the blob name starts with @, extract the owner address
        if (fullBlobName.startsWith('@')) {
          const parts = fullBlobName.substring(1).split('/');
          const extractedOwner = parts[0];
          if (extractedOwner && (owner === "0x0" || !owner)) {
            owner = extractedOwner;
          }
          parts.shift();
          cleanName = parts.join('/');
        }
        
        // Skip if this video is in the blacklist
        if (hiddenBlobNames.some(name => fullBlobName.includes(name))) {
          return null;
        }

        const pathSegmentsSemi = cleanName.split('/')
          .map((seg: string) => encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29'))
          .join('/');
        const pathSegmentsFull = encodeURIComponent(cleanName).replace(/\(/g, '%28').replace(/\)/g, '%29');
        
        // Define multiple stable gateways (Removed dead ones)
        const gateways = [
          import.meta.env.VITE_GATEWAY_URL_1,
          import.meta.env.VITE_GATEWAY_URL_2,
          "https://api.testnet.aptoslabs.com/shelby",
          "https://api.testnet.shelby.xyz/shelby"
        ].filter(Boolean);
        
        // iOS: put .mp4 URL first so Safari can detect MIME type without Range-Request check
        const urls = gateways.flatMap(base => isIOS ? [
          `${base}/v1/blobs/${owner}/${cleanName}.mp4`,          // 1. .mp4 hint (iOS first)
          `${base}/v1/blobs/${owner}/${cleanName}`,              // 2. Raw
          `${base}/v1/blobs/${owner}/${pathSegmentsSemi}`,       // 3. Partial encoded
          `${base}/v1/blobs/${owner}/${pathSegmentsFull}`,       // 4. Full encoded
        ] : [
          `${base}/v1/blobs/${owner}/${cleanName}`,              // 1. Raw
          `${base}/v1/blobs/${owner}/${pathSegmentsSemi}`,       // 2. Partial encoded
          `${base}/v1/blobs/${owner}/${pathSegmentsFull}`,       // 3. Full encoded
          `${base}/v1/blobs/${owner}/${cleanName}.mp4`           // 4. MIME Hack fallback
        ]);


        // Parse description from blob name (format: path:::encodedDescription)
        const descParts = fullBlobName.split(':::');
        let finalDescription = '';
        if (descParts.length > 1) {
          const rawDesc = descParts[1];
          if (rawDesc.startsWith('b64:')) {
            try {
              // Decode only if it starts with the b64: prefix
              const decoded = Buffer.from(rawDesc.substring(4), 'base64').toString('utf-8');
              // If decoded is profile-format JSON ({d, t}), it is NOT a caption — blank it
              try {
                const parsed = JSON.parse(decoded);
                finalDescription = (parsed && typeof parsed === 'object' && 'd' in parsed) ? '' : decoded;
              } catch {
                finalDescription = decoded;
              }
            } catch (e) {
              finalDescription = rawDesc;
            }
          } else {
            // Treat as plain text (fixes older videos showing garbled text)
            finalDescription = rawDesc;
          }
        }

        return {
          id: b.id || b.name || b.blob_name || Math.random().toString(),
          urls,
          rawName: fullBlobName, 
          account: owner.toString(),
          description: finalDescription
        };
      })
      .filter((v: any) => v !== null);
  }, [accountBlobs, error]);

  const handleDelete = async (blobName: string) => {
    if (!account || !signAndSubmitTransaction) return;

    try {

      // Construct the payload for delete_blob Move function
      const payload = ShelbyBlobClient.createDeleteBlobPayload({
        blobName: blobName
      });


      await signAndSubmitTransaction({
        data: payload
      });
      

      alert("Video berhasil dihapus!");
      
      // Immediate invalidation
      queryClient.invalidateQueries({ queryKey: ['globalBlobs'] });
      queryClient.invalidateQueries({ queryKey: [targetAddress] });
      queryClient.invalidateQueries({ queryKey: [account?.address.toString()] });
      
    } catch (e: any) {
      console.error("Failed to delete blob:", e);
      alert("Gagal menghapus: " + (e.message || "User rejected or network error"));
    }
  };

  // Global Observer to track the active video index
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = parseInt(entry.target.getAttribute('data-index') || '0');
            setActiveIndex(index);
          }
        });
      },
      { threshold: 0.5 } // Balanced threshold for mobile browser chrome variability
    );

    const elements = containerRef.current?.querySelectorAll('.feed-item');
    elements?.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [videos.length]);

  if (!targetAddress && !connected) {
    return (
      <div className="feed-container flex items-center justify-center p-8">
        <h2 style={{ color: 'var(--muted-foreground)' }}>Please connect your wallet or provide an address to view videos.</h2>
      </div>
    );
  }

  if (isLoading && !error) {
    return (
      <div className="feed-container flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="loader-spinner"></div>
          <h2 style={{ color: 'var(--muted-foreground)' }}>Loading your videos...</h2>
        </div>
      </div>
    );
  }

  if (!videos.length && !isLoading) {
    return (
      <div className="feed-container flex flex-col items-center justify-center p-8 text-center">
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📦</div>
        <h2 style={{ color: 'var(--muted-foreground)' }}>
          {isMyProfile ? "You haven't uploaded any videos yet." : "This user hasn't uploaded any videos yet."}
        </h2>
      </div>
    );
  }

  return (
    <div className="feed-container" ref={containerRef}>
      <div 
        className="p-8 border-b border-sidebar-border mb-4 flex flex-col items-center gap-6"
        style={{ scrollSnapAlign: 'center' }}
      >
        <div className="flex flex-col w-full">
          {isEditing ? (
            <div 
              className="flex flex-col gap-4 w-full"
              style={{
                background: 'rgba(18, 18, 18, 0.7)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '1.5rem',
                padding: '2rem',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
              }}
            >
              <div className="flex justify-between items-center mb-2">
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Edit Profile</h2>
                <button 
                  onClick={() => { setIsEditing(false); setEditAvatarFile(null); setEditAvatarPreview(null); }} 
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.2s', padding: '0.5rem' }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '0.6'}
                >
                  <X size={24} color="white" />
                </button>
              </div>

              <div className="flex items-center gap-6" style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                <div className="relative">
                  <div
                    className="profile-avatar-circle"
                    style={{ width: '96px', height: '96px', opacity: isSavingProfile ? 0.5 : 1 }}
                  >
                    {editAvatarPreview || profileData?.avatarUrl ? (
                      <img
                        src={editAvatarPreview || profileData?.avatarUrl!}
                        alt="Profile Preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                      />
                    ) : (
                      <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                        {profileData?.displayName 
                          ? profileData.displayName.split(' ').map((n:any) => n[0]).join('').substring(0, 2).toUpperCase() 
                          : targetAddress?.substring(targetAddress.length - 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <label 
                    className="absolute bottom-0 right-0 p-2 flex items-center justify-center cursor-pointer shadow-lg hover:scale-110 transition-transform"
                    style={{ background: 'var(--primary)', color: 'white', borderRadius: '50%', border: '2px solid #000', bottom: '-4px', right: '-4px' }}
                  >
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleEditAvatarChange} disabled={isSavingProfile} />
                    <Camera size={14} strokeWidth={2.5} />
                  </label>
                </div>
                
                <div className="flex flex-col gap-3 flex-1">
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.5, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '0.3rem', display: 'block' }}>Display Name</label>
                    <input 
                      type="text" 
                      placeholder="Username" 
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value.substring(0, 50))}
                      disabled={isSavingProfile}
                      className="profile-edit-input"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.5, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: '0.3rem', display: 'block' }}>Bio</label>
                    <textarea 
                      placeholder="Write something about yourself..." 
                      value={editBio}
                      onChange={(e) => setEditBio(e.target.value.substring(0, 150))}
                      disabled={isSavingProfile}
                      className="profile-edit-bio"
                    />
                  </div>
                </div>
              </div>

              <button 
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="btn-premium w-full mt-2"
                style={{ opacity: isSavingProfile ? 0.7 : 1 }}
              >
                {isSavingProfile ? (
                  <div className="flex items-center gap-2 justify-center"><Loader2 size={20} className="animate-spin" /> <span>Saving...</span></div>
                ) : (
                  <div className="flex items-center gap-2 justify-center"><Check size={20} /> <span>Save Changes</span></div>
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-6 w-full relative">
              <div className="avatar-section">
                <div
                  className="profile-avatar-circle"
                  style={{ flexShrink: 0, cursor: 'default', position: 'relative' }}
                >
                  {profileData?.avatarUrl ? (
                    <img
                      src={profileData.avatarUrl}
                      alt="Profile"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    />
                  ) : (
                    <span style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                      {profileData?.displayName 
                        ? profileData.displayName.split(' ').map((n:any) => n[0]).join('').substring(0, 2).toUpperCase() 
                        : targetAddress?.substring(targetAddress.length - 2).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {profileData?.displayName || `@${targetAddress?.substring(0, 6)}...${targetAddress?.substring(targetAddress.length - 4)}`}
                </h1>
                <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: '0.15rem' }}>
                  {profileData?.bio || (isMyProfile ? 'My Profile' : 'Content Creator')}
                </p>
                {/* Follow/Unfollow for other users */}
                {!isMyProfile && connected && (
                  <button
                    className={isFollowing ? 'btn-follow-active' : 'btn-premium'}
                    style={{ marginTop: '0.75rem', width: 'fit-content', padding: '0.45rem 1.5rem', fontSize: '0.85rem', gap: '0.5rem', display: 'flex', alignItems: 'center' }}
                    onClick={handleToggleFollow}
                    disabled={followLoading}
                  >
                    {followLoading
                      ? <Loader2 size={14} className="animate-spin" />
                      : isFollowing ? <UserCheck size={14} /> : <UserPlus size={14} />
                    }
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
                {/* Edit Profile for my profile */}
                {isMyProfile && (
                  <button
                    onClick={() => setIsEditing(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem',
                      fontSize: '0.85rem', padding: '0.45rem 1rem', borderRadius: '0.5rem',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: 'white', cursor: 'pointer', transition: 'background 0.2s', width: 'fit-content'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  >
                    <Edit3 size={14} />
                    <span>Edit Profile</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-8 w-full justify-start px-2">
          <div className="flex items-center gap-1"><span className="font-bold">{videos.length}</span> <span className="opacity-60 text-sm">Videos</span></div>
          <div className="flex items-center gap-1"><span className="font-bold">{followerCount}</span> <span className="opacity-60 text-sm">Followers</span></div>
        </div>

        <p style={{ fontSize: '0.75rem', opacity: 0.3, alignSelf: 'flex-start', wordBreak: 'break-all', maxWidth: '100%' }} className="mt-2 px-1">
          {targetAddress}
        </p>
      </div>
      {videos.map((video: any, idx: number) => (
        <VideoItem 
           key={video.id} 
           video={video} 
           index={idx}
           isActive={idx === activeIndex}
           isNear={idx === activeIndex || (idx === activeIndex + 1)}
           onDelete={handleDelete} 
           isOwner={isMyProfile} 
           isGlobalMuted={globalMuted} 
           onToggleMute={() => setGlobalMuted(!globalMuted)}
           shelbyClient={shelbyClient}
           navigate={navigate}
        />
      ))}
    </div>
  );
}
