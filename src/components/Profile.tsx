import { Buffer } from 'buffer';
import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useAccountBlobs, useShelbyClient } from '@shelby-protocol/react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Order_By, ShelbyBlobClient } from '@shelby-protocol/sdk/browser';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Heart, MessageCircle, Share2, Trash2, Volume2, VolumeX, Play, Pause, Repeat, Star, UserPlus, UserCheck, Loader2, Edit3, X, Check, Camera, Maximize } from 'lucide-react';
import CommentsModal from './CommentsModal';
import { checkBlobExists, getFollowBlobName, toggleFollow as socialToggleFollow, getFollowerCount, fetchProfile, getLikeCount, getVideoHash, normalizeAddr } from '../services/social';
import { useToast } from './ToastContext';

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
      }, 'image/jpeg', 0.5);
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
  isNear,
  forceLoad = false,
  isProfileGrid = false,
  onPointerEnter,
  onPointerLeave,
  onOpen,
  isFullscreenViewer = false,
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
  isNear: boolean,
  forceLoad?: boolean,
  isProfileGrid?: boolean,
  onPointerEnter?: () => void,
  onPointerLeave?: () => void,
  onOpen?: () => void,
  isFullscreenViewer?: boolean,
}) {
  const [hasError, setHasError] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showFeedback, setShowFeedback] = useState<'play' | 'pause' | null>(null);
  const [liked, setLiked] = useState(false);
  const [urlIndex, setUrlIndex] = useState(0); // Multi-gateway fallback
  const videoRef = useRef<HTMLVideoElement>(null);
  const { showToast } = useToast();

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
    const rawUrl = (isNear || forceLoad || isProfileGrid) ? (video.urls[urlIndex] ?? '') : '';
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
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    try {
      await onDelete(video.rawName);
    } catch (e) {
      console.error("Delete error:", e);
    } finally {
      setIsDeleting(false);
    }
  };

  // Feed Logic: Auto-play/pause based on parent's activeIndex
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
          Try Again
        </button>
      </div>

    );
  }

  return (
    <div
      className={`feed-item${isFullscreenViewer ? ' profile-fullscreen-item' : ''}`}
      data-index={index}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {showDeleteConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(8px)' }}
        >
          <div style={{ width: '100%', maxWidth: '340px', padding: '1.35rem', borderRadius: '1rem', background: '#18181b', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', boxSizing: 'border-box' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem', lineHeight: 1.25, fontWeight: 800 }}>Delete video?</h2>
            <p style={{ margin: '0.6rem 0 1.25rem', color: 'rgba(255,255,255,0.65)', fontSize: '0.9rem', lineHeight: 1.45 }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button type="button" onClick={() => void confirmDelete()} className="btn-premium" style={{ width: '100%', height: '42px', padding: '0 1rem', borderRadius: '0.6rem', fontSize: '0.9rem' }}>Delete</button>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} style={{ width: '100%', height: '42px', padding: '0 1rem', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '0.6rem', background: 'transparent', color: 'white', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div className="video-click-layer" onClick={isProfileGrid && onOpen ? onOpen : togglePlayPause}></div>
      
      {showFeedback && (
        <div className={`video-feedback-icon animate-feedback`}>
          {showFeedback === 'play' ? <Play size={80} fill="white" /> : <Pause size={80} fill="white" />}
        </div>
      )}

      {/* Persistent play icon appears when paused (even if buffering) so user can tap to resume */}
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
        className={isProfileGrid ? "video-main profile-card-video" : "video-main"}
        loop
        autoPlay={isActive}
        playsInline={true}
        preload="auto"
        muted={true}
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

      {/* Global Style: Bottom Progress Bar */}
      {!isProfileGrid && (
        <>
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

              <div className="action-item" onClick={(e) => { e.stopPropagation(); setShowComments(true); }}>
                <div className="action-icon-bg">
                  <MessageCircle size={34} color="white" />
                </div>
                <span className="action-count">Comments</span>
              </div>

              <div className="action-item" onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard?.writeText(`${window.location.origin}/profile/${video.account}`);
                showToast('Link copied to clipboard!', 'success');
              }}>
                <div className="action-icon-bg">
                  <Share2 size={34} color="white" />
                </div>
                <span className="action-count">Share</span>
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

              {isOwner && (
                <div className="action-item" onClick={handleDeleteClick}>
                  <div className="action-icon-bg" style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '50%' }}>
                    <Trash2 size={24} color="white" />
                  </div>
                  <span className="action-count">{isDeleting ? "..." : "Delete"}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {isProfileGrid && (
        <>
          <div className="video-progress-container profile-grid-progress" aria-hidden="true">
            <div 
              className="video-progress-bar" 
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          {isOwner && (
            <button
              type="button"
              aria-label="Delete video"
              title="Delete video"
              onClick={handleDeleteClick}
              disabled={isDeleting}
              style={{
                position: 'absolute',
                top: '0.75rem',
                right: '0.75rem',
                zIndex: 20,
                width: '2.5rem',
                height: '2.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.65)',
                color: 'white',
                cursor: isDeleting ? 'wait' : 'pointer',
              }}
            >
              <Trash2 size={20} />
            </button>
          )}
        </>
      )}
      {showComments && (
        <CommentsModal videoId={video.id || video.rawName} onClose={() => setShowComments(false)} />
      )}
    </div>
  );
}



export default function Profile() {
  const { address } = useParams();
  const { account, connected, signAndSubmitTransaction } = useWallet();
  const { showToast } = useToast();
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Edit Profile State
  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null);
  const [activeProfileTab, setActiveProfileTab] = useState<'videos' | 'reposts' | 'favorites' | 'liked'>('videos');
  const [hoveredVideoIndex, setHoveredVideoIndex] = useState<number | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);

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
      alert("Please enter a display name first.");
      return;
    }
    
    setIsSavingProfile(true);

    try {
      const normAddr = normalizeAddr(targetAddress);
      const expirationMicros = (Date.now() * 1000) + (365 * 24 * 60 * 60 * 1000000);

      // Build the blob data: full profile JSON including optional avatar
      let avatarBase64Value: string | null = profileData?.avatarUrl || null;

      if (editAvatarFile) {
        try {
          const compressedBytes = await compressAvatar(editAvatarFile);
          avatarBase64Value = `data:image/jpeg;base64,${Buffer.from(compressedBytes).toString('base64')}`;
        } catch (err: any) {
          alert('The image could not be processed. Please use another image.');
          setIsSavingProfile(false);
          return;
        }
      }

      // NEW PROTOCOL: Stable Prefix + Unique Suffix (Base64 encoded timestamp)
      const saveTimestamp = Date.now();
      const b64Timestamp = Buffer.from(saveTimestamp.toString()).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const finalBlobName = `shelby-clip/profile.mp4:::b64:${b64Timestamp}`;
      const finalBlobData = new Uint8Array(Buffer.from(JSON.stringify({
        displayName: editDisplayName.trim(),
        bio: editBio.trim(),
        avatarBase64: avatarBase64Value,
        timestamp: saveTimestamp
      })));

      await new Promise<void>((resolve, reject) => {
        uploadBlobs.mutate({
          signer: { account, signAndSubmitTransaction },
          blobs: [{ blobName: finalBlobName, blobData: finalBlobData }],
          expirationMicros,
          options: { selectedLocation: 'shelbynet-1' }
        }, {
          onSuccess: () => resolve(),
          onError: (e: any) => reject(e)
        });
      });

      const finalProfileData = {
        displayName: editDisplayName.trim(),
        bio: editBio.trim(),
        avatarUrl: avatarBase64Value || null,
        timestamp: saveTimestamp
      };
      
      localStorage.setItem(`shelby_profile_${normAddr}`, JSON.stringify(finalProfileData));
      
      queryClient.setQueryData(['profile', targetAddress], {
        displayName: finalProfileData.displayName,
        bio: finalProfileData.bio,
        avatarUrl: finalProfileData.avatarUrl
      });

      queryClient.invalidateQueries({ queryKey: ['profile', targetAddress] });
      
      showToast("Profile saved successfully!", 'success');
      setIsEditing(false);
      setEditAvatarFile(null);
      setIsSavingProfile(false);
      
    } catch (e: any) {
      console.error("Sequential Upload Error:", e);
      showToast("Failed to update profile: " + (e.message || "Unknown error"), 'error');
      setIsSavingProfile(false);
    }
  };

  // Follow state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [likesCount, setLikesCount] = useState(0);

  const getLocalFollowingCount = useCallback((addr: string) => {
    const normalized = normalizeAddr(addr);
    if (!normalized) return 0;
    let count = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(`shelby_follow:${normalized}:`)) count += 1;
    }
    return count;
  }, []);

  // ---- Load follow state & follower count ----
  useEffect(() => {
    if (!targetAddress) return;
    getFollowerCount(shelbyClient, targetAddress).then(setFollowerCount);
    setFollowingCount(getLocalFollowingCount(targetAddress));
    if (connected && account && !isMyProfile) {
      checkBlobExists(account.address.toString(), getFollowBlobName(targetAddress)).then(setIsFollowing);
    }
  }, [targetAddress, connected, account?.address, shelbyClient, isMyProfile, getLocalFollowingCount]);

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
    object_name: { _ilike: "%shelby-clip/%:::%" }
  };


  const { data: accountBlobs, isLoading, error } = useAccountBlobs({
    account: (targetAddress || "0x1") as any,
    orderBy: { updated_at: Order_By.Desc },
    pagination: { limit: 100 },
    where: videoFilters,
    enabled: !!targetAddress,
    refetchInterval: 10000, 
  });

  const videos = useMemo<Video[]>(() => {
    if (error || !accountBlobs) return [];

    const blobList = Array.isArray(accountBlobs)
      ? accountBlobs
      : (accountBlobs as any).blobs || (accountBlobs as any).hits || [];

    const gateways = [
      import.meta.env.VITE_GATEWAY_URL_1,
      import.meta.env.VITE_GATEWAY_URL_2,
      "https://media-kit.shelby.xyz",
      "https://api.shelbynet.shelby.xyz/shelby",
      "https://shelby.shelbynet.shelby.xyz/shelby"
    ].filter(Boolean);

    return blobList.map((blob: any) => {
      const rawName = blob.object_name || blob.blob_name || blob.blobNameSuffix || blob.name || "";
      const lowerName = rawName.toLowerCase();
      if (!rawName.includes("shelby-clip/") || !rawName.includes(":::") ||
          lowerName.includes("/profile") || lowerName.includes("/avatar") ||
          lowerName.includes("/social") || lowerName.includes("/metadata")) {
        return null;
      }

      const owner = (blob.owner || blob.address || blob.owner_address || targetAddress || "0x0").toString().replace(/^@/, "");
      const cleanName = rawName.startsWith("@") ? rawName.substring(1).split("/").slice(1).join("/") : rawName;
      const pathSegmentsSemi = cleanName.split("/")
        .map((segment: string) => encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29"))
        .join("/");
      const pathSegmentsFull = encodeURIComponent(cleanName).replace(/\(/g, "%28").replace(/\)/g, "%29");
      const variants = [owner];
      if (owner.startsWith("0x")) {
        const cleanOwner = owner.replace(/^0x/, "");
        variants.push(cleanOwner.length === 64
          ? "0x" + cleanOwner.replace(/^0+/, "")
          : "0x" + cleanOwner.padStart(64, "0"));
      }
      const urls = gateways.flatMap((base) => variants.flatMap((variant) => isIOS ? [
        `${base}/v1/blobs/${variant}/${cleanName}.mp4`,
        `${base}/v1/blobs/${variant}/${cleanName}`,
        `${base}/v1/blobs/${variant}/${pathSegmentsSemi}`,
        `${base}/v1/blobs/${variant}/${pathSegmentsFull}`
      ] : [
        `${base}/v1/blobs/${variant}/${cleanName}`,
        `${base}/v1/blobs/${variant}/${pathSegmentsSemi}`,
        `${base}/v1/blobs/${variant}/${pathSegmentsFull}`,
        `${base}/v1/blobs/${variant}/${cleanName}.mp4`
      ]));

      const rawDescription = rawName.split(":::")[1] || "";
      let description = rawDescription === "m" ? "" : rawDescription;
      if (rawDescription.startsWith("b64:")) {
        try {
          description = Buffer.from(rawDescription.substring(4), "base64").toString("utf-8");
        } catch {
          description = rawDescription;
        }
      }

      return {
        id: blob.id || blob.name || blob.blob_name || rawName,
        rawName,
        urls,
        account: owner,
        description
      };
    }).filter((video: Video | null): video is Video => video !== null);
  }, [accountBlobs, error, isIOS, targetAddress]);

  useEffect(() => {
    if (!shelbyClient || videos.length === 0) {
      setLikesCount(0);
      return;
    }

    let cancelled = false;
    const loadLikes = async () => {
      try {
        const counts = await Promise.all(
          videos.slice(0, 20).map((video: Video) => getLikeCount(shelbyClient, getVideoHash(video.rawName)))
        );
        if (!cancelled) {
          setLikesCount(counts.reduce((sum, value) => sum + value, 0));
        }
      } catch {
        if (!cancelled) setLikesCount(0);
      }
    };

    void loadLikes();
    return () => { cancelled = true; };
  }, [shelbyClient, videos]);

  const handleDelete = async (blobName: string) => {
    if (!account || !signAndSubmitTransaction) return;

    try {

      // Construct the payload for delete_blob Move function
      const payload = ShelbyBlobClient.createDeleteObjectPayload({
        blobName: blobName
      });


      await signAndSubmitTransaction({
        data: payload
      });
      

      showToast("Video deleted successfully!", 'success');
      
      // Immediate invalidation
      queryClient.invalidateQueries({ queryKey: ['globalBlobs'] });
      queryClient.invalidateQueries({ queryKey: [targetAddress] });
      queryClient.invalidateQueries({ queryKey: [account?.address.toString()] });
      
    } catch (e: any) {
      console.error("Failed to delete blob:", e);
      alert("Failed to delete: " + (e.message || "User rejected or network error"));
    }
  };

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
    <div className="feed-container profile-page" ref={containerRef}>
      <div 
        className="p-4 border-b border-sidebar-border mb-2 flex flex-col items-center gap-3"
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
            <div className="flex items-start gap-6 w-full relative">
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
              <div className="flex flex-col gap-2 flex-1 profile-header-main">
                <div>
                  <h1 style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                    {profileData?.displayName || `@${targetAddress?.substring(0, 6)}...${targetAddress?.substring(targetAddress.length - 4)}`}
                  </h1>
                </div>

                <div className="profile-header-stats profile-stats-container">
                  <div className="profile-header-stat">
                    <span className="font-bold">{videos.length}</span>
                    <span className="opacity-60 text-sm">Videos</span>
                  </div>
                  <div className="profile-header-stat">
                    <span className="font-bold">{followerCount}</span>
                    <span className="opacity-60 text-sm">Followers</span>
                  </div>
                  <div className="profile-header-stat">
                    <span className="font-bold">{followingCount}</span>
                    <span className="opacity-60 text-sm">Following</span>
                  </div>
                  <div className="profile-header-stat">
                    <span className="font-bold">{likesCount}</span>
                    <span className="opacity-60 text-sm">Likes</span>
                  </div>
                </div>

                <div className="profile-header-actions">
                  {!isMyProfile && connected && (
                    <button
                      className={isFollowing ? 'btn-follow-active' : 'btn-premium'}
                      style={{ width: 'fit-content', padding: '0.45rem 1.5rem', fontSize: '0.85rem', gap: '0.5rem', display: 'inline-flex', alignItems: 'center' }}
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
                  {isMyProfile && (
                    <button
                      onClick={() => setIsEditing(true)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 1rem', borderRadius: '0.5rem',
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

                <p className="profile-header-bio">
                  {profileData?.bio || (isMyProfile ? 'My Profile' : 'Content Creator')}
                </p>

                <div className="profile-tabs-container mt-4">
                  <div className="profile-tab-list">
                    {[
                      { key: 'videos', icon: <Play size={16} />, label: 'Videos' },
                      { key: 'reposts', icon: <Repeat size={16} />, label: 'Reposts' },
                      { key: 'favorites', icon: <Star size={16} />, label: 'Favorites' },
                      { key: 'liked', icon: <Heart size={16} />, label: 'Liked' },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        className={`profile-tab ${activeProfileTab === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveProfileTab(tab.key as any)}
                        type="button"
                        aria-label={tab.label}
                      >
                        <span className="profile-tab-icon">{tab.icon}</span>
                        <span className="profile-tab-label">{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {!profileData?.displayName && targetAddress && (
          <p style={{ fontSize: '0.75rem', opacity: 0.3, alignSelf: 'flex-start', wordBreak: 'break-all', maxWidth: '100%' }} className="mt-2 px-1">
            {targetAddress}
          </p>
        )}
      </div>
      <h2 className="profile-videos-heading">Videos</h2>
      <div className="profile-video-grid">
        {videos.map((video: any, idx: number) => (
          <VideoItem 
             key={video.id} 
             video={video} 
             index={idx}
             isActive={hoveredVideoIndex === idx}
             isNear={true}
             forceLoad={true}
             isProfileGrid={true}
             onDelete={handleDelete} 
             isOwner={isMyProfile} 
             isGlobalMuted={true} 
             onToggleMute={() => { }}
             onOpen={() => setSelectedVideo(video)}
             onPointerEnter={() => setHoveredVideoIndex(idx)}
             onPointerLeave={() => setHoveredVideoIndex(null)}
             shelbyClient={shelbyClient}
             navigate={navigate}
          />
        ))}
      </div>
      {selectedVideo && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }}>
          <button
            type="button"
            aria-label="Close video"
            onClick={() => setSelectedVideo(null)}
            style={{ position: 'absolute', top: '1rem', left: '1rem', zIndex: 1010, width: '2.5rem', height: '2.5rem', border: 'none', borderRadius: '50%', background: 'rgba(255,255,255,0.14)', color: 'white', fontSize: '1.5rem', cursor: 'pointer' }}
          >
            <X size={22} />
          </button>
          <VideoItem
            video={selectedVideo}
            onDelete={handleDelete}
            isOwner={isMyProfile}
            isGlobalMuted={false}
            onToggleMute={() => {}}
            index={0}
            shelbyClient={shelbyClient}
            navigate={navigate}
            isActive={true}
            isNear={true}
            isFullscreenViewer={true}
          />
        </div>
      )}
    </div>
  );
}
