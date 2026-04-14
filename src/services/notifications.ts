
import { getVideoHash, decodeComment } from './social';

const GATEWAYS = [
  'https://api.testnet.aptoslabs.com/shelby',
  'https://api.testnet.shelby.xyz/shelby',
];

const LAST_READ_KEY = 'shelby_notif_last_read';

export function getLastReadTimestamp(): number {
  return parseInt(localStorage.getItem(LAST_READ_KEY) || '0');
}

export function markNotificationsRead(): void {
  localStorage.setItem(LAST_READ_KEY, Date.now().toString());
}

export interface Notification {
  id: string;
  type: 'like' | 'comment' | 'follow' | 'repost';
  actor: string;
  videoId?: string;
  commentText?: string;
  timestamp: number;
  isNew: boolean;
}

function blobTs(b: { updated_at?: string | number; created_at?: string | number; uploaded_at?: string | number }): number {
  const raw = b.updated_at || b.created_at || b.uploaded_at || '';
  if (!raw) return 0;
  const ms = typeof raw === 'number' ? raw : new Date(raw).getTime();
  return isNaN(ms) ? 0 : ms;
}

// Fetch hashes of current user's own videos
async function fetchMyVideoHashes(shelbyClient: any, myAddress: string): Promise<Set<string>> {
  try {
    const result = await shelbyClient.coordination.getBlobs({
      where: { 
        blob_name: { _ilike: '%shelby-clip/%' },
        owner_address: { _eq: myAddress } 
      },
      pagination: { limit: 100 },
    });
    
    let rawList: any[] = Array.isArray(result)
      ? result
      : (result as any)?.blobs ?? (result as any)?.data ?? (result as any)?.data?.blobs ?? [];

    // Fallback: manual filter if indexer query is brittle
    if (rawList.length === 0) {
      const globalResult = await shelbyClient.coordination.getBlobs({
        where: { blob_name: { _ilike: '%shelby-clip/%' } },
        pagination: { limit: 200 },
      });
      const globalList: any[] = Array.isArray(globalResult)
        ? globalResult
        : (globalResult as any)?.blobs ?? (globalResult as any)?.data ?? (globalResult as any)?.data?.blobs ?? [];
      
      rawList = globalList.filter((b: any) => {
        const owner = (b.owner || b.address || b.owner_address || '').replace(/^@/, '');
        return owner === myAddress || owner.includes(myAddress.replace('0x', ''));
      });
    }

    const hashes = new Set<string>();
    rawList.forEach((b: any) => {
      const name = b.blob_name || b.name || '';
      // Only consider actual video blobs (those following our naming convention)
      if (name.includes(':::')) {
        hashes.add(getVideoHash(name));
      }
    });

    return hashes;
  } catch (e) { 
    console.error('[Notifications] Error fetching own videos:', e);
    return new Set(); 
  }
}

function extractOwnerAndName(b: any): { actor: string; blobName: string } {
  let actor = (b.owner || b.address || b.owner_address || '').replace(/^@/, '');
  let blobName = b.blob_name || b.name || '';
  if (blobName.startsWith('@')) {
    const parts = blobName.substring(1).split('/');
    actor = parts.shift() || actor;
    blobName = parts.join('/');
  }
  return { actor, blobName };
}

export async function fetchNotifications(
  shelbyClient: any,
  myAddress: string,
): Promise<Notification[]> {
  const lastRead = getLastReadTimestamp();
  const notifications: Notification[] = [];
  
  try {
    const myHashes = await fetchMyVideoHashes(shelbyClient, myAddress);

    // Batch fetch social interactions
    const result = await shelbyClient.coordination.getBlobs({
      where: { blob_name: { _ilike: '%shelby-clip/social/%' } },
      pagination: { limit: 200 },
    });

    const allSocial: any[] = Array.isArray(result)
      ? result
      : (result as any)?.blobs ?? (result as any)?.data ?? (result as any)?.data?.blobs ?? [];

    for (const b of allSocial) {
      const { actor, blobName: rawName } = extractOwnerAndName(b);
      if (!actor || actor === myAddress) continue;

      const ts = blobTs(b);
      const isNew = ts > lastRead;

      // Normalize name for easier matching
      const cleanName = rawName.replace(/^shelby-clip\//, '');

      // 1. New followers
      if (cleanName.startsWith('social/follow-')) {
        const target = cleanName.split('follow-')[1];
        if (target === myAddress || target.includes(myAddress.replace('0x', ''))) {
          notifications.push({ id: b.id || `follow-${actor}`, type: 'follow', actor, timestamp: ts, isNew });
        }
      } 
      
      // 2. Activities on MY videos
      else if (cleanName.includes('social/like-') || cleanName.includes('social/comment-') || cleanName.includes('social/repost-')) {
        const parts = cleanName.split('-');
        if (parts.length < 2) continue;
        
        const hash = parts[1];
        if (myHashes.has(hash)) {
          if (cleanName.includes('social/like-')) {
            notifications.push({ id: b.id || `like-${hash}-${actor}`, type: 'like', actor, videoId: hash, timestamp: ts, isNew });
          } else if (cleanName.includes('social/repost-')) {
            notifications.push({ id: b.id || `repost-${hash}-${actor}`, type: 'repost', actor, videoId: hash, timestamp: ts, isNew });
          } else if (cleanName.includes('social/comment-')) {
            let commentText = '';
            for (const base of GATEWAYS) {
              try {
                const res = await fetch(`${base}/v1/blobs/${actor}/shelby-clip/${cleanName}`);
                if (res.ok) { 
                  commentText = decodeComment(await res.text()); 
                  break; 
                }
              } catch {
                // Ignore errors from specific notification fetch attempts
              }
            }
            notifications.push({ id: b.id || `comment-${hash}-${actor}-${ts}`, type: 'comment', actor, videoId: hash, commentText, timestamp: ts, isNew });
          }
        }
      }
    }
  } catch (e) {
    console.error('[Notifications] Main fetch error:', e);
  }

  const seen = new Set<string>();
  return notifications
    .filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 60);
}

