import { useState, useEffect, useRef } from 'react';
import { useShelbyClient } from '@shelby-protocol/react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { X, Send, Loader2 } from 'lucide-react';
import { fetchComments, getCommentBlobName, encodeComment, getVideoHash, type Comment } from '../services/social';

interface Props {
  videoId: string;
  onClose: () => void;
}

export default function CommentsModal({ videoId, onClose }: Props) {
  const shelbyClient = useShelbyClient();
  const uploadBlobs = useUploadBlobs({});
  const { account, signAndSubmitTransaction, connected } = useWallet();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const videoHash = getVideoHash(videoId);

  useEffect(() => {
    setLoading(true);

    fetchComments(shelbyClient, videoHash).then(c => {

      setComments(c);
      setLoading(false);
    });
  }, [videoId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments]);

  const handlePost = async () => {
    if (!text.trim() || !account || !signAndSubmitTransaction) return;
    setPosting(true);
    try {
      const ts = Date.now();
      const blobName = getCommentBlobName(videoHash, ts);
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
      const myAddr = account.address.toString();
      setComments(c => [...c, { text: text.trim(), author: myAddr, timestamp: ts, id: blobName }]);
      setText('');
    } catch (e: any) {
      alert('Failed to post: ' + (e.message || e));
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
              <div key={c.id} className="comment-item">
                <div className="comment-avatar">
                  {c.author.substring(2, 4).toUpperCase()}
                </div>
                <div className="comment-body">
                  <span className="comment-author">
                    @{c.author.substring(0, 6)}...{c.author.substring(c.author.length - 4)}
                  </span>
                  <p className="comment-text">{c.text}</p>
                </div>
              </div>
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
