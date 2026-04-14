import { Buffer } from 'buffer';
import { ShelbyBlobClient, Order_By } from '@shelby-protocol/sdk/browser';


// Gateways for blob existence checks
export const GATEWAYS = [
  'https://api.testnet.aptoslabs.com/shelby',
  'https://api.testnet.shelby.xyz/shelby',
];


// ---- Blob name helpers ----
export function normalizeBlobName(name: string): string {
  if (!name) return '';
  // Handle @owner/path format
  let clean = name.startsWith('@') ? name.substring(name.indexOf('/') + 1) : name;
  // Handle shelby-clip/ prefix
  if (clean.startsWith('shelby-clip/')) clean = clean.substring(12);
  // Separate metadata (after :::)
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

// ---- Blob existence (GET and check 200) ----
export async function checkBlobExists(ownerAddress: string, blobName: string): Promise<boolean> {
  for (const base of GATEWAYS) {
    try {
      const res = await fetch(`${base}/v1/blobs/${ownerAddress}/${blobName}`);
      if (res.ok) return true;
      if (res.status === 404) return false; // Definitive no
    } catch {
      // Ignore errors from specific gateways, we try others
    }
  }
  return false;
}

// ---- Toggle like (upload empty blob OR delete) ----
export async function toggleLike(
  isLiked: boolean,
  videoHash: string,
  account: any,
  signAndSubmitTransaction: any,
  uploadBlobs: any,
): Promise<boolean> {
  const blobName = getLikeBlobName(videoHash);
  if (isLiked) {
    // Unlike: delete the blob
    const payload = ShelbyBlobClient.createDeleteBlobPayload({ blobName });
    await signAndSubmitTransaction({ data: payload });
    return false;
  } else {
    // Like: upload empty marker
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

// ---- Toggle follow ----
export async function toggleFollow(
  isFollowing: boolean,
  targetAddress: string,
  account: any,
  signAndSubmitTransaction: any,
  uploadBlobs: any,
): Promise<boolean> {
  const blobName = getFollowBlobName(targetAddress);
  if (isFollowing) {
    const payload = ShelbyBlobClient.createDeleteBlobPayload({ blobName });
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

// ---- Repost (upload marker) ----
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

// ---- Encode/Decode comment text ----
export function encodeComment(text: string): string {
  return 'b64:' + Buffer.from(text).toString('base64');
}

export function decodeComment(raw: string): string {
  if (raw.startsWith('b64:')) {
    try { return Buffer.from(raw.substring(4), 'base64').toString('utf-8'); } catch { return raw; }
  }
  return raw;
}

// ---- Fetch comments for a video ----
export interface Comment {
  text: string;
  author: string;
  timestamp: number;
  id: string;
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
      where: { blob_name: { _ilike: pattern } },
      pagination: { limit: 100 },
    });
    
    const list = normalizeBlobs(result);

    const comments: Comment[] = [];
    for (const b of list) {
      let owner = (b.owner || b.address || b.owner_address || '').replace(/^@/, '');
      const fullBlobName = b.blob_name || b.name || '';

      // Extract owner if using the @owner/path format
      if (fullBlobName.startsWith('@')) {
        owner = fullBlobName.substring(1).split('/')[0] || owner;
      }
      
      const blobName = fullBlobName.startsWith('@') 
        ? fullBlobName.substring(fullBlobName.indexOf('/') + 1)
        : fullBlobName;

      if (!owner || !blobName) continue;

      for (const base of GATEWAYS) {
        try {
          const res = await fetch(`${base}/v1/blobs/${owner}/${blobName}`);
          if (res.ok) {
            const raw = await res.text();
            const text = decodeComment(raw);
            // Extract timestamp from the last segment after the last dash
            const lastDash = blobName.lastIndexOf('-');
            const ts = lastDash >= 0 ? parseInt(blobName.substring(lastDash + 1)) || 0 : 0;
            comments.push({ text, author: owner, timestamp: ts, id: b.id || blobName });
            break;
          }
        } catch {
          // Ignore gateway-specific fetch errors
        }
      }
    }
    return comments.sort((a, b) => a.timestamp - b.timestamp);
  } catch (e) {
    console.error('fetchComments error:', e);
    return [];
  }
}

// ---- Count likes for a video ----
export async function getLikeCount(shelbyClient: any, videoHash: string): Promise<number> {
  try {
    const result = await shelbyClient.coordination.getBlobs({
      where: { blob_name: { _ilike: `%shelby-clip/social/like-${videoHash}%` } },
      pagination: { limit: 1000 },
    });
    // Handle multiple response shapes
    const list: any[] = Array.isArray(result)
      ? result
      : (result as any)?.blobs ?? (result as any)?.data?.blobs ?? [];
    return list.length;
  } catch { return 0; }
}

// ---- Count followers for an address ----
export async function getFollowerCount(shelbyClient: any, targetAddress: string): Promise<number> {
  try {
    const result = await shelbyClient.coordination.getBlobs({
      where: { blob_name: { _ilike: `%shelby-clip/social/follow-${targetAddress}%` } },
      pagination: { limit: 1000 },
    });
    const list: any[] = Array.isArray(result)
      ? result
      : (result as any)?.blobs ?? (result as any)?.data?.blobs ?? [];
    return list.length;
  } catch { return 0; }
}

// ---- Unified Profile Normalization & Fetching ----
export function normalizeAddr(addr: string): string {
  if (!addr) return '';
  // Ensure we have a clean 0x prefix and lowercased address for consistency
  const clean = addr.toLowerCase().trim().replace(/^@/, '').replace(/^0x/, '');
  if (!clean) return '';
  return '0x' + clean;
}

export function getAddressVariants(addr: string): string[] {
  const norm = normalizeAddr(addr);
  if (!norm) return [];
  const clean = norm.replace(/^0x/, '');
  const short = '0x' + clean;
  // Standard Aptos address is 64 chars (32 bytes)
  const long = '0x' + clean.padStart(64, '0');
  return Array.from(new Set([short, long]));
}


export interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  bio: string;
}

export async function fetchProfile(shelbyClient: any, addr: string): Promise<UserProfile | null> {
  try {
    const norm = normalizeAddr(addr);
    if (!norm) return null;

    
    // 1. Try LocalStorage for immediate load (Optimistic UI)
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
    } catch {
      // Silently fail for local storage parse errors
    }

    let json: any = {};
    let indexerTimestamp = 0;
    let avatarUrl = localProfile?.avatarUrl || null;

    let gatewayProfile: UserProfile | null = null;
    let gatewayTimestamp = 0;

    // 1.5 FAST PREFIX SEARCH (Optimized Indexer Query)
    // Instantly try to resolve the most recent blob that follows our stable-prefix protocol.
    try {
      const variants = getAddressVariants(addr);
      const res = await (shelbyClient as any).coordination.getBlobs({
        where: {
          owner_address: { _in: variants },
          blob_name: { _ilike: 'shelby-clip/profile.mp4:::b64:%' }
        },
        pagination: { limit: 1 },
        orderBy: [{ updated_at: Order_By.Desc }] as any
      });
      
      const list = normalizeBlobs(res);
      if (list.length > 0) {
        const b = list[0];
        const bName = b.blob_name || '';
        const segments = bName.split(':::b64:');
        if (segments.length > 1) {
          const b64Part = segments[1];
          try {
            const standardB64 = b64Part.replace(/-/g, '+').replace(/_/g, '/');
            const suffixTs = parseInt(Buffer.from(standardB64, 'base64').toString('utf8'));

            if (suffixTs > 0) {
              gatewayTimestamp = suffixTs;
              
              // Try all gateways and all address variants for maximum reliability
              outer: for (const gateway of GATEWAYS) {
                for (const v of variants) {
                  try {
                    const blobRes = await fetch(`${gateway}/v1/blobs/${v}/${bName}?t=${suffixTs}`, { cache: 'no-store' });
                    if (blobRes.ok) {
                      const parsed = JSON.parse(await blobRes.text());
                      gatewayProfile = {
                        displayName: parsed.displayName || parsed.name || parsed.username || '',
                        bio: parsed.bio || parsed.description || parsed.about || '',
                        avatarUrl: parsed.avatarBase64 || parsed.avatarUrl || parsed.avatar || parsed.image || null
                      };
                      break outer; // Success!
                    }
                  } catch (e) { /* continue */ }
                }
              }
            }
          } catch (e) {
            console.warn("Failed to decode profile sync timestamp:", e);
          }
        }
      }
    } catch (e) {
      console.warn("Fast-prefix search failed:", e);
    }

    // 2. Query target user's profile metadata from Indexer (Unique Path Radar)
    try {
      const variants = getAddressVariants(addr);
      // Global Pattern Radar: Search for ALL blobs following the standard profile/avatar naming convention
      // This allows finding randomized/timestamped names from ANY dApp
      const pList = await shelbyClient.coordination.getBlobs({
        where: {
          owner_address: { _in: variants.filter((v: string) => !v.startsWith('@')) }
        },
        pagination: { limit: 50 },
        orderBy: { updated_at: Order_By.Desc }
      });

      // Handle multiple response shapes
      const list: any[] = Array.isArray(pList)
        ? pList
        : (pList as any)?.blobs ?? (pList as any)?.data?.blobs ?? [];

      if (list && list.length > 0) {
        // Deep Inspection: Reconcile multiple versions across many paths
        let bestCandidate: any = null;
        let bestTimestamp = -1;
        let bestAvatarUrl = avatarUrl;
        let bestAvatarTimestamp = -1;

        for (const blob of list) {
          try {
            let bName = blob.blob_name;
            let bOwner = blob.owner_address || variants[0];
            
            if (bName.startsWith('@')) {
              const parts = bName.substring(1).split('/');
              bOwner = parts[0] || bOwner;
              bName = bName.substring(bName.indexOf('/') + 1);
            }

            // V2 SINGLE BLOB PROTOCOL DECODING
            // Look for `p_` (legacy randomized), `profile.mp4` (current stable), or legacy v2
            if ((bName.includes('p_') || bName.includes('profile.mp4') || bName.includes('profile_v2') || bName.includes('_profile')) && bName.includes(':::b64:')) {
              try {
                const b64 = bName.split(':::b64:')[1];
                const standardB64 = b64.replace(/-/g, '+').replace(/_/g, '/');
                const parsed = JSON.parse(Buffer.from(standardB64, 'base64').toString('utf8'));
                
                // Explicit check to ensure this is actually a Profile blob and not a Video blob (we moved bio into body, so check for 'd' or 'displayName')
                if (parsed.displayName !== undefined || parsed.d !== undefined) {
                  if (parsed.t > bestTimestamp) {
                    bestTimestamp = parsed.t;
                    bestCandidate = { displayName: parsed.d || parsed.displayName, bio: '', t: parsed.t }; // Temporary O(1) resolve until json fetches
                  }

                  // Capture JSON payload reference if it's the latest JSON payload (now spoofed as .mp4)
                  if (parsed.t > bestAvatarTimestamp) {
                    bestAvatarTimestamp = parsed.t;
                    
                    // FETCH the actual JSON blob payload to get the full profile body
                    try {
                      // Fire and forget fetch
                      const jsonRes = await fetch(`${GATEWAYS[0]}/v1/blobs/${bOwner}/${bName}?t=${parsed.t}`);
                      if (jsonRes.ok) {
                        try {
                           // Try to parse the true JSON wrapper out of the MP4 disguise
                           const jsonData = await jsonRes.json();
                           // Hydrate full data:
                           if (parsed.t === bestTimestamp) {
                              bestCandidate = jsonData; // The json array contains the un-truncated bio and displayName
                           }
                           if (jsonData.avatarBase64) {
                             bestAvatarUrl = jsonData.avatarBase64;
                           }
                        } catch (e) {
                           // If json parsing fails, it means it's an actual legacy MP4 video/image payload! Fallback logic:
                           bestAvatarUrl = `${GATEWAYS[0]}/v1/blobs/${bOwner}/${bName}?t=${parsed.t}`;
                        }
                      }
                    } catch (e) {
                      // Ignored
                    }
                  }
                  continue;
                }
              } catch {
                // Not a valid profile metadata JSON
              }
            }

            // V1 Legacy Support
            if (bName.toLowerCase().includes('avatar') && !bName.includes('profile_v2')) {
              if (blob.updated_at > bestAvatarTimestamp / 1000) {
                const potentialAvatar = `${GATEWAYS[0]}/v1/blobs/${bOwner}/${bName}?t=${Date.now()}`;
                bestAvatarTimestamp = blob.updated_at * 1000;
                bestAvatarUrl = potentialAvatar;
              }
              continue;
            }

            // V1 Legacy Metadata Parsing
            if (bName.toLowerCase().includes('profile') && !bName.includes('profile_v2')) {
              for (const gateway of GATEWAYS) {
                const res = await fetch(`${gateway}/v1/blobs/${bOwner}/${bName}?t=${Date.now()}`, { cache: 'no-store' });
                if (res.ok) {
                  const raw = await res.text();
                  const parsed = JSON.parse(raw);
                  const ts = parsed.timestamp || parsed.updated_at || 0;
                  if (ts > bestTimestamp) {
                    bestTimestamp = ts;
                    bestCandidate = parsed;
                    if (parsed.avatarUrl || parsed.avatar || parsed.image) {
                       bestAvatarUrl = parsed.avatarUrl || parsed.avatar || parsed.image;
                    }
                  }
                  break;
                }
              }
            }
          } catch {
            // Ignore individual fetch/parse errors
          }
        }

        if (bestCandidate) {
          json = bestCandidate;
          indexerTimestamp = bestTimestamp;
          avatarUrl = bestAvatarUrl;
        }
      }
    } catch {
      // Indexer radar failed
    }

    // 3. Reconciliation: pick the freshest source.
    // indexerTimestamp from safeDesc `t` is in SECONDS; localStorage and gateway are in ms. Normalise.
    const indexerTimestampMs = indexerTimestamp > 1e12 ? indexerTimestamp : indexerTimestamp * 1000;

    // localStorage wins if it is the most recent
    if (localProfile && localTimestamp > Math.max(gatewayTimestamp, indexerTimestampMs)) {
      return localProfile;
    }

    // gateway (profile-metadata.json) wins if newer than indexer
    if (gatewayProfile && gatewayTimestamp >= indexerTimestampMs) {
      return { ...gatewayProfile, avatarUrl: gatewayProfile.avatarUrl || avatarUrl };
    }

    // indexer blob payload as last resort
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

