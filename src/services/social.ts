import { Buffer } from 'buffer';
import { ShelbyBlobClient, Order_By } from '@shelby-protocol/sdk/browser';
import { normalizeAddress } from './aptosClient';
import type { Comment, UserProfile } from '../types';

// Gateways for blob existence checks - pulled from ENV with fallbacks
export const GATEWAYS = [
  import.meta.env.VITE_GATEWAY_URL_1,
  import.meta.env.VITE_GATEWAY_URL_2,
  'https://api.shelbynet.shelby.xyz/shelby',
  'https://shelby.shelbynet.shelby.xyz/shelby',
].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index);

/**
 * Robust Address Variants for Indexer/Gateway Discovery
 */
export function getAddressVariants(addr: string): string[] {
  const norm = normalizeAddress(addr);
  if (!norm) return [];
  const clean = norm.replace(/^0x/, '');
  const short = '0x' + clean.replace(/^0+/, '');
  const long = '0x' + clean.padStart(64, '0');
  return Array.from(new Set([short, long]));
}

// ---- Blob name helpers ----
export function normalizeBlobName(name: string): string {
  if (!name) return '';
  let clean = name.startsWith('@') ? name.substring(name.indexOf('/') + 1) : name;
  if (clean.startsWith('shelby-clip/')) clean = clean.substring(12);
  return clean.split(':::')[0];
}

export function getVideoHash(blobName: string): string {
  const slug = normalizeBlobName(blobName);
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    const char = slug.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export const getLikeBlobName   = (hash: string) => `shelby-clip/social/like-${hash}`;
export const getFollowBlobName = (addr: string)  => `shelby-clip/social/follow-${addr}`;
export const getRepostBlobName = (hash: string) => `shelby-clip/social/repost-${hash}`;
export const getCommentBlobName = (hash: string, ts: number) =>
  `shelby-clip/social/comment-${hash}-${ts}`;
export const FOLLOW_SIGNAL_TYPE = 3;
export const UNFOLLOW_SIGNAL_TYPE = 4;

export function getLocalFollowKey(follower: string, target: string) {
  return `shelby_follow:${normalizeAddress(follower)}:${normalizeAddress(target)}`;
}

export function getLocalFollowState(follower: string, target: string): boolean {
  return localStorage.getItem(getLocalFollowKey(follower, target)) === '1';
}

export function setLocalFollowState(follower: string, target: string, following: boolean) {
  const key = getLocalFollowKey(follower, target);
  if (following) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
}

export function getLocalFollowerCount(target: string): number {
  const normalizedTarget = normalizeAddress(target);
  if (!normalizedTarget) return 0;
  let count = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i) || '';
    if (key.startsWith('shelby_follow:') && key.endsWith(`:${normalizedTarget}`)) {
      count += 1;
    }
  }
  return count;
}

export function getBlobOwnerAddress(blob: any, fallbackAddress = ''): string {
  const fullBlobName = blob?.object_name || blob?.blob_name || blob?.blobNameSuffix || blob?.name || '';;
  if (fullBlobName.startsWith('@')) {
    const extractedOwner = fullBlobName.substring(1).split('/')[0];
    const normalizedExtracted = normalizeAddress(extractedOwner);
    if (normalizedExtracted) return normalizedExtracted;
  }

  const candidates = [
    blob?.owner_address,
    blob?.owner,
    blob?.account_address,
    blob?.account,
    fallbackAddress,
    blob?.address,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeAddress(String(candidate || '').replace(/^@/, ''));
    if (normalized) return normalized;
  }

  return '';
}

// ---- Blob existence ----
export async function checkBlobExists(ownerAddress: string, blobName: string): Promise<boolean> {
  const normalizedOwner = normalizeAddress(ownerAddress);
  for (const base of GATEWAYS) {
    try {
      const res = await fetch(`${base}/v1/blobs/${normalizedOwner}/${blobName}`);
      if (res.ok) return true;
      if (res.status === 404) return false; 
    } catch { /* ignore */ }
  }
  return false;
}

// ---- Social Actions ----
export async function toggleLike(
  isLiked: boolean,
  videoHash: string,
  account: any,
  signAndSubmitTransaction: any,
  uploadBlobs: any,
): Promise<boolean> {
  const blobName = getLikeBlobName(videoHash);
  if (isLiked) {
    const payload = ShelbyBlobClient.createDeleteObjectPayload({ blobName });
    await signAndSubmitTransaction({ data: payload });
    return false;
  } else {
    await new Promise<void>((resolve, reject) => {
      uploadBlobs.mutate(
        {
          signer: { account, signAndSubmitTransaction },
          blobs: [{ blobName, blobData: new Uint8Array([1]) }],
          expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000),
        },
        { onSuccess: () => resolve(), onError: (e: any) => reject(e) }
      );
    });
    return true;
  }
}

export async function toggleFollow(
  isFollowing: boolean,
  targetAddress: string,
  account: any,
  signAndSubmitTransaction: any,
  uploadBlobs: any,
): Promise<boolean> {
  const blobName = getFollowBlobName(targetAddress);
  if (isFollowing) {
    const payload = ShelbyBlobClient.createDeleteObjectPayload({ blobName });
    await signAndSubmitTransaction({ data: payload });
    return false;
  } else {
    await new Promise<void>((resolve, reject) => {
      uploadBlobs.mutate(
        {
          signer: { account, signAndSubmitTransaction },
          blobs: [{ blobName, blobData: new Uint8Array([1]) }],
          expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000),
        },
        { onSuccess: () => resolve(), onError: (e: any) => reject(e) }
      );
    });
    return true;
  }
}

export async function repost(
  videoHash: string,
  account: any,
  signAndSubmitTransaction: any,
  uploadBlobs: any,
): Promise<void> {
  const blobName = getRepostBlobName(videoHash);
  await new Promise<void>((resolve, reject) => {
    uploadBlobs.mutate(
      {
        signer: { account, signAndSubmitTransaction },
        blobs: [{ blobName, blobData: new Uint8Array([1]) }],
        expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000),
      },
      { onSuccess: () => resolve(), onError: (e: any) => reject(e) }
    );
  });
}

// ---- Data Handling ----
export function encodeComment(text: string): string {
  return 'b64:' + Buffer.from(text).toString('base64');
}

export function decodeComment(raw: string): string {
  if (raw.startsWith('b64:')) {
    try { return Buffer.from(raw.substring(4), 'base64').toString('utf-8'); } catch { return raw; }
  }
  return raw;
}

function normalizeBlobs(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (result?.blobs && Array.isArray(result.blobs)) return result.blobs;
  if (result?.data?.blobs && Array.isArray(result.data.blobs)) return result.data.blobs;
  return [];
}

export async function fetchComments(shelbyClient: any, videoHash: string): Promise<Comment[]> {
  try {
    const pattern = `%shelby-clip/social/comment-${videoHash}%`;
    const result = await shelbyClient.coordination.getBlobs({
      where: { object_name: { _ilike: pattern } },
      pagination: { limit: 100 },
    });
    
    const list = normalizeBlobs(result);
    const comments: Comment[] = [];

    for (const b of list) {
      let ownerRaw = (b.owner || b.address || b.owner_address || '').replace(/^@/, '');
      const fullBlobName = b.object_name || b.blob_name || b.name || '';
      if (fullBlobName.startsWith('@')) {
        ownerRaw = fullBlobName.substring(1).split('/')[0] || ownerRaw;
      }
      const blobNamePath = fullBlobName.startsWith('@') 
        ? fullBlobName.substring(fullBlobName.indexOf('/') + 1)
        : fullBlobName;

      if (!ownerRaw || !blobNamePath) continue;

      const variants = getAddressVariants(ownerRaw);
      const encodedPath = blobNamePath.split('/')
        .map((seg: string) => encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29'))
        .join('/');

      outer: for (const base of GATEWAYS) {
        for (const variant of variants) {
          const pathsToTry = [encodedPath, blobNamePath, fullBlobName];
          for (const path of pathsToTry) {
            try {
              const res = await fetch(`${base}/v1/blobs/${variant}/${path}`);
              if (res.ok) {
                const raw = await res.text();
                if (raw.length < 2 && (blobNamePath.includes('like') || blobNamePath.includes('repost'))) continue;
                const text = decodeComment(raw);
                const lastDash = blobNamePath.lastIndexOf('-');
                const ts = lastDash >= 0 ? parseInt(blobNamePath.substring(lastDash + 1)) || 0 : 0;
                comments.push({ text, author: variant, timestamp: ts, id: b.id || fullBlobName });
                break outer;
              }
            } catch { /* continue */ }
          }
        }
      }
    }
    return comments.sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.error('fetchComments error:', e);
    return [];
  }
}

// ---- Counters ----
export async function getLikeCount(shelbyClient: any, videoHash: string): Promise<number> {
  try {
    const result = await shelbyClient.coordination.getBlobs({
      where: { object_name: { _ilike: `%shelby-clip/social/like-${videoHash}%` } },
      pagination: { limit: 1000 },
    });
    return normalizeBlobs(result).length;
  } catch { return 0; }
}

export async function getCommentCount(shelbyClient: any, videoHash: string): Promise<number> {
  try {
    const result = await shelbyClient.coordination.getBlobs({
      where: { object_name: { _ilike: `%shelby-clip/social/comment-${videoHash}%` } },
      pagination: { limit: 1000 },
    });
    return normalizeBlobs(result).length;
  } catch { return 0; }
}

export async function getRepostCount(shelbyClient: any, videoHash: string): Promise<number> {
  try {
    const result = await shelbyClient.coordination.getBlobs({
      where: { object_name: { _ilike: `%shelby-clip/social/repost-${videoHash}%` } },
      pagination: { limit: 1000 },
    });
    return normalizeBlobs(result).length;
  } catch { return 0; }
}

export async function getFollowerCount(shelbyClient: any, targetAddress: string): Promise<number> {
  try {
    const res2 = await shelbyClient.coordination.getBlobs({
      where: { object_name: { _ilike: `%follow-${targetAddress}%` } },
      pagination: { limit: 1000 }
    });
    return normalizeBlobs(res2).length;
  } catch { return 0; }
}

export async function checkIsVerified(
  aptos: any,
  contractAddress: string,
  addr: string
): Promise<boolean> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${contractAddress}::shelby_social::is_user_verified`,
        typeArguments: [],
        functionArguments: [addr],
      }
    });
    return result[0] === true;
  } catch { return false; }
}

// ---- Profile ----
export { normalizeAddress as normalizeAddr };

export async function fetchProfile(shelbyClient: any, addr: string): Promise<UserProfile | null> {
  try {
    const norm = normalizeAddress(addr);
    if (!norm) return null;
    const addressVariants = getAddressVariants(norm);

    let localProfile: UserProfile | null = null;
    let localTimestamp = 0;
    try {
      const stored = localStorage.getItem(`shelby_profile_${norm}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.displayName || parsed.name) {
          localProfile = {
            displayName: parsed.displayName || parsed.name || '',
            bio: parsed.bio || parsed.description || parsed.about || '',
            avatarUrl: parsed.avatarUrl || parsed.avatar || parsed.image || null
          };
          localTimestamp = parsed.timestamp || 0;
        }
      }
    } catch { /* ignore */ }

    let json: any = {};
    let indexerTimestamp = 0;
    let avatarUrl = localProfile?.avatarUrl || null;
    let gatewayProfile: UserProfile | null = null;
    let gatewayTimestamp = 0;

    // 1. Prefix search
    try {
      let res: any = null;
      for (const ownerField of ['owner']) {
        for (const ownerAddress of addressVariants) {
          try {
            res = await (shelbyClient as any).coordination.getBlobs({
              where: { [ownerField]: { _eq: ownerAddress }, object_name: { _ilike: 'shelby-clip/profile.mp4:::b64:%' } },
              pagination: { limit: 1 },
              orderBy: [{ updated_at: Order_By.Desc }] as any
            });
          } catch {
            res = null;
          }
          if (normalizeBlobs(res).length > 0) break;
        }
        if (normalizeBlobs(res).length > 0) break;
      }
      const list = normalizeBlobs(res);
      if (list.length > 0) {
        const bName = list[0].object_name || list[0].blob_name || '';
        const b64Part = bName.split(':::b64:')[1];
        if (b64Part) {
          const suffixTs = parseInt(Buffer.from(b64Part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
          if (suffixTs > 0) {
            gatewayTimestamp = suffixTs;
            outer: for (const gateway of GATEWAYS) {
              for (const ownerAddress of addressVariants) {
                try {
                  const blobRes = await fetch(`${gateway}/v1/blobs/${ownerAddress}/${bName}?t=${suffixTs}`);
                  if (blobRes.ok) {
                    const parsed = JSON.parse(await blobRes.text());
                    gatewayProfile = {
                      displayName: parsed.displayName || parsed.name || parsed.username || '',
                      bio: parsed.bio || parsed.description || parsed.about || '',
                      avatarUrl: parsed.avatarBase64 || parsed.avatarUrl || parsed.avatar || parsed.image || null
                    };
                    break outer;
                  }
                } catch { /* ignore */ }
              }
            }
          }
        }
      }
    } catch { /* ignore */ }

    // 2. Indexer search
    try {
      let pList: any = null;
      for (const ownerField of ['owner']) {
        for (const ownerAddress of addressVariants) {
          try {
            pList = await shelbyClient.coordination.getBlobs({
              where: { [ownerField]: { _eq: ownerAddress } },
              pagination: { limit: 50 },
              orderBy: { updated_at: Order_By.Desc }
            });
          } catch {
            pList = null;
          }
          if (normalizeBlobs(pList).length > 0) break;
        }
        if (normalizeBlobs(pList).length > 0) break;
      }
      const list = normalizeBlobs(pList);
      if (list.length > 0) {
        let bestCandidate: any = null;
        let bestTimestamp = -1;
        let bestAvatarUrl = avatarUrl;
        let bestAvatarTimestamp = -1;

        for (const blob of list) {
          try {
            let bName = blob.object_name || blob.blob_name || '';
            let bOwner = getBlobOwnerAddress(blob, norm) || norm;
            
            if (bName.startsWith('@')) {
              const parts = bName.substring(1).split('/');
              bOwner = parts[0] || bOwner;
              bName = bName.substring(bName.indexOf('/') + 1);
            }

            if ((bName.includes('p_') || bName.includes('profile.mp4') || bName.includes('profile_v2')) && bName.includes(':::b64:')) {
              try {
                const b64 = bName.split(':::b64:')[1];
                const parsed = JSON.parse(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
                
                if (parsed.displayName !== undefined || parsed.d !== undefined) {
                  const ts = parsed.t || parsed.timestamp || 0;
                  if (ts > bestTimestamp) {
                    bestTimestamp = ts;
                    bestCandidate = { displayName: parsed.d || parsed.displayName, bio: '', t: ts };
                  }

                  if (ts > bestAvatarTimestamp) {
                    bestAvatarTimestamp = ts;
                    try {
                      const jsonRes = await fetch(`${GATEWAYS[0]}/v1/blobs/${bOwner}/${blob.object_name || blob.blob_name}?t=${ts}`);
                      if (jsonRes.ok) {
                        const jsonData = await jsonRes.json();
                        if (ts === bestTimestamp) bestCandidate = jsonData;
                        if (jsonData.avatarBase64) bestAvatarUrl = jsonData.avatarBase64;
                      }
                    } catch {
                      bestAvatarUrl = `${GATEWAYS[0]}/v1/blobs/${bOwner}/${blob.object_name || blob.blob_name}?t=${ts}`;
                    }
                  }
                }
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        }

        if (bestCandidate) {
          json = bestCandidate;
          indexerTimestamp = bestTimestamp;
          avatarUrl = bestAvatarUrl;
        }
      }
    } catch { /* ignore */ }

    const indexerTimestampMs = indexerTimestamp > 1e12 ? indexerTimestamp : indexerTimestamp * 1000;

    if (localProfile && localTimestamp > Math.max(gatewayTimestamp, indexerTimestampMs)) {
      return localProfile;
    }
    if (gatewayProfile && gatewayTimestamp >= indexerTimestampMs) {
      return { ...gatewayProfile, avatarUrl: gatewayProfile.avatarUrl || avatarUrl };
    }
    if (json.displayName || json.name || json.username) {
      return {
        displayName: json.displayName || json.name || json.username || '',
        bio: json.bio || json.description || json.about || '',
        avatarUrl: avatarUrl || json.avatarUrl || json.avatar || json.image || null
      };
    }
    return localProfile;
  } catch (e) {
    console.error("fetchProfile failed:", e);
    return null;
  }
}

// ---- Contract View Queries ----

/**
 * Check if a buyer has on-chain access to a specific video (via purchase_video tx)
 */
export async function checkVideoAccess(
  aptos: any,
  contractAddress: string,
  buyer: string,
  creator: string,
  videoId: string
): Promise<boolean> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${contractAddress}::shelby_social::has_video_access_v2`,
        typeArguments: [],
        functionArguments: [buyer, creator, videoId],
      }
    });
    return result[0] === true;
  } catch { return false; }
}

/**
 * Get the on-chain price (in Octas) set for a video. Returns 0 if not set.
 */
export async function getVideoPrice(
  aptos: any,
  contractAddress: string,
  videoId: string
): Promise<number> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${contractAddress}::shelby_social::get_video_price`,
        typeArguments: [],
        functionArguments: [videoId],
      }
    });
    return Number(result[0]) || 0;
  } catch { return 0; }
}
/**
 * Get the monthly subscription price for a creator
 */
export async function getSubscriptionPrice(
  aptos: any,
  contractAddress: string,
  creator: string
): Promise<number> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${contractAddress}::shelby_social::get_subscription_price`,
        typeArguments: [],
        functionArguments: [creator],
      }
    });
    return Number(result[0]) || 0;
  } catch { return 0; }
}

/**
 * Check if a user is actively subscribed to a creator
 */
export async function checkIsSubscribed(
  aptos: any,
  contractAddress: string,
  subscriber: string,
  creator: string
): Promise<boolean> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${contractAddress}::shelby_social::is_subscribed`,
        typeArguments: [],
        functionArguments: [subscriber, creator],
      }
    });
    return result[0] === true;
  } catch { return false; }
}

/**
 * Get the current view count for a video
 */
export async function getViewCount(
  aptos: any,
  contractAddress: string,
  videoId: string
): Promise<number> {
  try {
    const result = await aptos.view({
      payload: {
        function: `${contractAddress}::shelby_social::get_view_count`,
        typeArguments: [],
        functionArguments: [videoId],
      }
    });
    return Number(result[0]) || 0;
  } catch { return 0; }
}

// ---- Off-chain Analytics (IP-based) ----
const COUNTER_API_BASE = 'https://api.counterapi.dev/v1/tezqee';

export async function getOffChainViewCount(videoHash: string): Promise<number> {
  try {
    const res = await fetch(`${COUNTER_API_BASE}/view_${videoHash}`);
    if (res.ok) {
      const data = await res.json();
      return data.count || 0;
    }
  } catch (e) {
    console.error("Error fetching off-chain views:", e);
  }
  return 0;
}

export async function recordViewOffChain(videoHash: string): Promise<void> {
  try {
    // 1. Check local storage if this user (IP-based simulation) has viewed recently
    const lastView = localStorage.getItem(`view_${videoHash}`);
    const now = Date.now();
    
    // Only count once every 1 hour per browser/IP simulation
    if (lastView && (now - parseInt(lastView)) < 3600000) {
      return;
    }

    // 2. Increment counter on public API
    await fetch(`${COUNTER_API_BASE}/view_${videoHash}/up`);
    
    localStorage.setItem(`view_${videoHash}`, now.toString());
  } catch (e) {
    console.error("Error recording off-chain view:", e);
  }
}
