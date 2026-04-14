import { useState, useEffect, useRef, useMemo } from 'react';
import { useShelbyClient } from '@shelby-protocol/react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { X, Send, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchComments, getCommentBlobName, encodeComment, getVideoHash, fetchProfile, type Comment } from '../services/social';

interface Props {
  videoId: string;
  onClose: () => void;
}

export default function CommentsModal({ videoId, onClose }: Props) {
  const shelbyClient = useShelbyClient();
  const uploadBlobs = useUploadBlobs({});
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const queryClient = useQueryClient();
  const videoHash = useMemo(() => getVideoHash(videoId), [videoId]);
  
  const { data: remoteComments = [], isLoading: loading, refetch } = useQuery({
    queryKey: ['comments', videoHash],
    queryFn: () => fetchComments(shelbyClient, videoHash),
    staleTime: 2000, 
    refetchInterval: 5000, // Faster polling while modal is open to catch propagation
  });

  // Force a fresh fetch when the modal is opened
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['comments', videoHash] });
  }, [videoHash]);

  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // LocalStorage Fallback for "My Pending Comments"
  const pendingKey = `pending_comments_${videoHash}`;
  const [pendingComments, setPendingComments] = useState<Comment[]>(() => {
    try {
      const saved = localStorage.getItem(pendingKey);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Sync pending comments to storage
  useEffect(() => {
    localStorage.setItem(pendingKey, JSON.stringify(pendingComments));
  }, [pendingComments, pendingKey]);

  // Merge remote and pending, filtering out duplicates if remote already has them
  const comments = useMemo(() => {
    const combined = [...remoteComments];
    pendingComments.forEach(p => {
      // If remote doesn't have it by text/timestamp approx, keep it pending
      if (!remoteComments.some(r => r.text === p.text && Math.abs(r.timestamp - p.timestamp) < 5000)) {
        combined.push(p);
      }
    });
    return combined.sort((a, b) => a.timestamp - b.timestamp);
  }, [remoteComments, pendingComments]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handlePost = async () => {
    if (!text.trim() || !account || !signAndSubmitTransaction) return;
    setPosting(true);
    const ts = Date.now();
    const blobName = getCommentBlobName(videoHash, ts);
    const myAddr = account.address.toString();
    const newComment: Comment = { text: text.trim(), author: myAddr, timestamp: ts, id: blobName };

    try {
      // 1. Optimistic Update (UI + Pending Storage)
      setPendingComments(prev => [...prev, newComment]);
      setText('');

      // 2. Real Upload
      const encoded = encodeComment(text.trim());
      const blobData = new TextEncoder().encode(encoded);
      await new Promise<void>((resolve, reject) => {
        uploadBlobs.mutate(
          {
            signer: { account, signAndSubmitTransaction },
            blobs: [{ blobName, blobData }],
            expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000),
          },
          { onSuccess: () => resolve(), onError: (e: any) => reject(e) }
        );
      });

      // 3. Refresh Query Cache
      queryClient.invalidateQueries({ queryKey: ['comments', videoHash] });
    } catch (e: any) {
      alert('Failed to post: ' + (e.message || e));
      // Remove failed comment from pending
      setPendingComments(prev => prev.filter(p => p.id !== blobName));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="comments-overlay" onClick={onClose}>
      <div className="comments-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="comments-header">
          <span />
          <h3 className="comments-title">Comments</h3>
          <button className="comments-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* List */}
        <div className="comments-list" ref={listRef}>
          {loading ? (
            <div className="comments-center">
              <Loader2 size={32} className="animate-spin" style={{ opacity: 0.4 }} />
            </div>
          ) : comments.length === 0 ? (
            <div className="comments-center" style={{ flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '2rem' }}>💬</span>
              <p style={{ opacity: 0.5, fontSize: '0.9rem' }}>No comments yet. Be the first!</p>
            </div>
          ) : (
            comments.map(c => (
              <CommentItem key={c.id} comment={c} shelbyClient={shelbyClient} />
            ))
          )}
        </div>

        {/* Input */}
        <div className="comments-input-row">
          {connected ? (
            <>
              <input
                className="comments-input"
                placeholder="Add a comment..."
                value={text}
                onChange={e => setText(e.target.value.substring(0, 200))}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handlePost()}
                maxLength={200}
                disabled={posting}
              />
              <button className="comments-send-btn" onClick={handlePost} disabled={!text.trim() || posting}>
                {posting
                  ? <Loader2 size={18} className="animate-spin" />
                  : <Send size={18} />
                }
              </button>
            </>
          ) : (
            <p style={{ opacity: 0.5, fontSize: '0.85rem', textAlign: 'center', width: '100%' }}>
              Connect wallet to comment
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentItem({ comment, shelbyClient }: { comment: Comment, shelbyClient: any }) {
  const { data: profile } = useQuery({
    queryKey: ['profile', comment.author],
    queryFn: () => fetchProfile(shelbyClient, comment.author),
    staleTime: 30000,
  });

  const displayName = profile?.displayName || `@${comment.author.substring(2, 6)}...${comment.author.substring(comment.author.length - 4)}`;
  const avatarUrl = profile?.avatarUrl;
  const initials = displayName.startsWith('@') 
    ? comment.author.substring(2, 4).toUpperCase()
    : displayName[0].toUpperCase();

  return (
    <div className="comment-item">
      <div className="comment-avatar">
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : initials}
      </div>
      <div className="comment-body">
        <span className="comment-author">{displayName}</span>
        <p className="comment-text">{comment.text}</p>
      </div>
    </div>
  );
}
