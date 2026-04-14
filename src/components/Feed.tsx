import { Buffer } from 'buffer';
import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useShelbyClient } from '@shelby-protocol/react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useQuery } from '@tanstack/react-query';
import { Order_By } from '@shelby-protocol/sdk/browser';
import { useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Share2, Plus, Volume2, VolumeX, Play, Pause, Repeat2, Loader2, Maximize } from 'lucide-react';
import CommentsModal from './CommentsModal';
import {
  getVideoHash, getLikeBlobName, checkBlobExists,
  toggleLike as socialToggleLike,
  repost as socialRepost,
  getLikeCount,
  fetchProfile,
  normalizeAddr,
} from '../services/social';



interface Video {
  id: string;
  rawName: string;
  urls: string[];
  account: string;
  description: string;
}

function VideoItem({ 
  video, 
  isGlobalMuted, 
  onToggleMute, 
  index, 
  isActive, 
  isNear 
}: { 
  video: Video, 
  isGlobalMuted: boolean, 
  onToggleMute: () => void, 
  index: number,
  activeIndex: number,
  isActive: boolean,
  isNear: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const shelbyClient = useShelbyClient();
  const uploadBlobs = useUploadBlobs({});

  const videoHash = useMemo(() => getVideoHash(video.rawName || video.id || ''), [video.id, video.rawName]);
  const creatorAddr = normalizeAddr(video.account);
  const myAddr = normalizeAddr(account?.address.toString() || '');

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

  const [hasError, setHasError] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);
  const [urlIndex, setUrlIndex] = useState(0);

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
          
          // CRITICAL: If this video is already active, start playing immediately 
          // after the blob is attached to the DOM.
          if (isActive) {
            videoRef.current.play().catch(() => {});
          }
        }
      })
      .catch(() => {
        // Fallback to direct URL if fetch/blob fails
        if (!cancelled) {
          if (isIOS) {
            handleVideoError();
          } else {
            setVideoSrc(rawUrl);
          }
        }
      })
      .finally(() => clearTimeout(timeout));

    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [isNear, urlIndex, isIOS, video.urls.join(',')]); // Stable dependency prevents blink on data refresh

  // Cleanup blob URL on unmount to prevent memory leak
  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);

  const [showFeedback, setShowFeedback] = useState<'play' | 'pause' | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [repostLoading, setRepostLoading] = useState(false);



  const { data: creatorProfile } = useQuery({
    queryKey: ['profile', creatorAddr],
    queryFn: () => fetchProfile(shelbyClient, creatorAddr),
    staleTime: 5000, // Sync faster globally (5 seconds)
  });


  // Load initial like status & count
  useEffect(() => {
    if (!video.id) return;
    getLikeCount(shelbyClient, videoHash).then(setLikeCount);
    if (connected && account) {
      checkBlobExists(myAddr, getLikeBlobName(videoHash)).then(setLiked);
    }
  }, [video.id, connected, myAddr, videoHash, shelbyClient]);

  const handleLike = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!connected || !account || !signAndSubmitTransaction) {
      alert('Connect your wallet to like!'); return;
    }
    if (likeLoading) return;
    setLikeLoading(true);
    const prev = liked;
    setLiked(!prev);
    setLikeCount(c => prev ? c - 1 : c + 1);
    try {
      await socialToggleLike(prev, videoHash, account, signAndSubmitTransaction, uploadBlobs);
    } catch (e: any) {
      setLiked(prev);
      setLikeCount(c => prev ? c + 1 : c - 1);
      if (!String(e?.message).includes('rejected')) alert('Like failed: ' + (e?.message || e));
    } finally {
      setLikeLoading(false);
    }
  }, [liked, likeLoading, connected, account, signAndSubmitTransaction, videoHash]);

  const handleShare = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/profile/${video.account}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    }
  }, [video.account]);

  const handleRepost = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!connected || !account || !signAndSubmitTransaction) {
      alert('Connect your wallet to repost!'); return;
    }
    if (repostLoading || reposted) return;
    setRepostLoading(true);
    try {
      await socialRepost(videoHash, account, signAndSubmitTransaction, uploadBlobs);
      setReposted(true);
    } catch (e: any) {
      if (!String(e?.message).includes('rejected')) alert('Repost failed: ' + (e?.message || e));
    } finally {
      setRepostLoading(false);
    }
  }, [reposted, repostLoading, connected, account, signAndSubmitTransaction, videoHash]);

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

  // TikTok Logic: Auto-play/pause based on parent's activeIndex
  useEffect(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    
    if (isActive) {
      // Don't set isBuffering(true) manually here; let the video element's
      // onWaiting/onPlaying events handle it naturally as data arrives.
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
      setHasError(true);
      setIsBuffering(false);
    }
  }, [isNear, urlIndex, video.urls.length, video.id, hasError]);

  // Active Failover: If buffering takes too long, switch gateway automatically
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (isBuffering && isNear && !hasError) {
      timeout = setTimeout(() => {
        handleVideoError();
      }, 12000); // Fair failover: 12s for IPFS/Arweave stability
    }
    return () => clearTimeout(timeout);
  }, [isBuffering, isNear, hasError, handleVideoError]);

  const displayName = creatorProfile?.displayName || `@${video.account.substring(0, 6)}...`;
  const initials = creatorProfile?.displayName 
    ? creatorProfile.displayName.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase() 
    : video.account.substring(video.account.length - 2).toUpperCase();

  // If the video fails to load after all retries, render a black placeholder
  // so the vertical scroll layout doesn't collapse and trigger rapid skipping.
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
          Retry
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
          <div className="username-tag" onClick={() => navigate(`/profile/${video.account}`)}>
            {displayName}
          </div>
        </div>

        <div className="side-actions">
          <div className="avatar-wrapper" onClick={() => navigate(`/profile/${video.account}`)}>
            {creatorProfile?.avatarUrl ? (
              <img src={creatorProfile.avatarUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            ) : (
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>
                {initials}
              </div>
            )}
            {!connected || (myAddr !== creatorAddr) ? (
              <div className="avatar-add">
                <Plus size={12} color="white" />
              </div>
            ) : null}
          </div>

          {/* Like */}
          <div className="action-item" onClick={handleLike}>
            <div className="action-icon-bg">
              {likeLoading && <Loader2 size={18} className="animate-spin" style={{ position: 'absolute', opacity: 0.5 }} />}
              <Heart
                size={34}
                fill={liked ? 'var(--primary)' : 'none'}
                color={liked ? 'var(--primary)' : 'white'}
                style={{ filter: liked ? 'drop-shadow(0 0 10px var(--primary))' : 'none', opacity: likeLoading ? 0.5 : 1 }}
              />
            </div>
            <span className="action-count">{likeCount >= 1000 ? `${(likeCount / 1000).toFixed(1)}K` : likeCount}</span>
          </div>

          <div className="action-item" onClick={e => { e.stopPropagation(); setShowComments(true); }}>
            <div className="action-icon-bg">
              <MessageCircle size={34} color="white" fill="none" />
            </div>
            <span className="action-count">Comments</span>
          </div>

          <div className="action-item" onClick={handleRepost}>
            <div className="action-icon-bg">
              {repostLoading
                ? <Loader2 size={34} className="animate-spin" color="white" />
                : <Repeat2 size={34} color={reposted ? 'var(--secondary)' : 'white'} />
              }
            </div>
            <span className="action-count" style={{ color: reposted ? 'var(--secondary)' : 'inherit' }}>
              {reposted ? 'Reposted' : 'Repost'}
            </span>
          </div>

          <div className="action-item" onClick={handleShare}>
            <div className="action-icon-bg">
              <Share2 size={34} color="white" fill="none" />
            </div>
            <span className="action-count">Share</span>
          </div>

          <div className="action-item" onClick={handleFullscreen}>
            <div className="action-icon-bg">
              <Maximize size={28} color="white" />
            </div>
            <span className="action-count">Full</span>
          </div>

          <div className="action-item" onClick={(e) => { e.stopPropagation(); onToggleMute(); }}>
            <div className="action-icon-bg">
              {isGlobalMuted ? <VolumeX size={28} color="white" /> : <Volume2 size={28} color="white" />}
            </div>
            <span className="action-count">{isGlobalMuted ? 'Muted' : 'Sound'}</span>
          </div>
        </div>
      </div>

      {showComments && (
        <CommentsModal videoId={video.id || video.rawName || ''} onClose={() => setShowComments(false)} />
      )}
    </div>
  );
}

export default function Feed() {
  const [globalMuted, setGlobalMuted] = useState(true);
  const shelbyClient = useShelbyClient();

  // iOS Detection: Safari on iOS requires .mp4 MIME hint to stream video
  const isIOS = typeof navigator !== 'undefined' && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const videoFilters = {
    is_written: { _eq: 1 as any },


    blob_name: { _ilike: "%shelby-clip/%:::%" }
  };


  const [showNewPill, setShowNewPill] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const topVideoIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Global Observer will be initialized after videos are defined to prevent ReferenceError


  const { data: globalBlobs, isLoading, error } = useQuery({
    queryKey: ['globalBlobs'],
    queryFn: async () => {
      return await shelbyClient.coordination.getBlobs({
        where: videoFilters,
        pagination: { limit: 100 },
        // Bypass poor SDK typescript signature that forces object but GraphQL strictly needs array
        orderBy: [{ updated_at: Order_By.Desc }] as any
      });
    },
    refetchInterval: 10000, 
  });


  const videos = useMemo(() => {
    if (error) return [];
    if (!globalBlobs) return [];

    // Debug: See what exactly we are getting from Shelby


    // Handle different possible response structures from SDK
    const blobList = Array.isArray(globalBlobs)
      ? globalBlobs
      : (globalBlobs as any).blobs || (globalBlobs as any).hits || [];

    // Blacklist for unwanted/test videos (Stricter filter reduces need for this)
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
        let owner = b.owner || b.address || b.owner_address || "0x0";
        let cleanName = fullBlobName;

        // Skip non-video blobs (profile metadata, avatar, social markers, etc.)
        const lowerName = fullBlobName.toLowerCase();
        const IS_INTERNAL = NON_VIDEO_PATTERNS.some(p => lowerName.includes(p.toLowerCase()));
        if (IS_INTERNAL) return null;
        
        // Strict naming check: Real videos follow the {timestamp}_{id} format (now with .mp4) before ':::'
        const hasAppPattern = fullBlobName.includes('shelby-clip/') && fullBlobName.includes(':::');
        
        // Final gate: Must have our app prefix and the metadata separator
        if (!hasAppPattern) return null;



        // Ensure owner is a string and remove any @ prefix
        owner = owner.toString().replace(/^@/, '');

        // If the blob name starts with @, it contains the owner address
        // Format: @0xABC/path/to/blob
        if (fullBlobName.startsWith('@')) {
          const parts = fullBlobName.substring(1).split('/');
          const extractedOwner = parts[0];
          // If extracted owner is found and we don't have a specific owner, use it
          if (extractedOwner && (owner === "0x0" || !owner)) {
            owner = extractedOwner;
          }
          parts.shift(); // Remove the owner part to get the clean path
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

        // Define multiple stable gateways for fallback (with .env support)
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

        const descParts = fullBlobName.split(':::');
        let finalDescription = '';
        if (descParts.length > 1) {
          const rawDesc = descParts[1];
          if (rawDesc.startsWith('b64:')) {
            try {
              finalDescription = Buffer.from(rawDesc.substring(4), 'base64').toString('utf-8');
            } catch (e) {
              finalDescription = rawDesc;
            }
          } else {
            finalDescription = rawDesc;
          }
        }

        return {
          id: b.id || b.name || b.blob_name || Math.random().toString(),
          rawName: fullBlobName,
          urls,
          account: owner.toString(),
          description: finalDescription
        };
      })
      .filter((v: any) => v !== null);
  }, [globalBlobs, error]);

  // Real-time detection of new videos
  useEffect(() => {
    if (videos.length > 0) {
      const latestId = videos[0].id;
      if (topVideoIdRef.current && topVideoIdRef.current !== latestId) {
        // If we already had a top ID and it changed, show the notification
        setShowNewPill(true);
      }
      topVideoIdRef.current = latestId;
    }
  }, [videos]);

  const handleRefreshFeed = () => {
    setShowNewPill(false);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
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

  if (isLoading && !error) {
    return (
      <div className="feed-container flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4">
          <div className="loader-spinner"></div>
          <h2 style={{ color: 'var(--muted-foreground)' }}>Loading Shelby Clip Feed...</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feed-container flex items-center justify-center p-8">
        <h2 style={{ color: 'var(--destructive)' }}>Error: {(error as Error).message}</h2>
      </div>
    );
  }

  if (!videos.length) {
    return (
      <div className="feed-container flex flex-col items-center justify-center p-8 text-center">
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎥</div>
        <h2 style={{ color: 'var(--muted-foreground)' }}>No videos found.</h2>
      </div>
    );
  }

  return (
    <div className="feed-container" ref={containerRef}>
      {showNewPill && (
        <div className="new-content-pill" onClick={handleRefreshFeed} style={{ padding: '0.6rem 1.5rem' }}>
          <span>New Videos Available!</span>
        </div>
      )}
      {videos.map((video: any, idx: number) => (
        <VideoItem
          key={video.id}
          video={video}
          index={idx}
          activeIndex={activeIndex}
          isNear={idx === activeIndex || (idx === activeIndex + 1)}
          isActive={idx === activeIndex}
          isGlobalMuted={globalMuted}
          onToggleMute={() => setGlobalMuted(!globalMuted)}
        />
      ))}
    </div>
  );
}
