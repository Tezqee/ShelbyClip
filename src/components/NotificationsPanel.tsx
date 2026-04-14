import { useState, useEffect, useCallback } from 'react';
import { useShelbyClient } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Bell, X, Heart, MessageCircle, Repeat2, UserPlus, Loader2, RefreshCw } from 'lucide-react';
import {
  fetchNotifications,
  markNotificationsRead,
  type Notification,
} from '../services/notifications';

function formatTime(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function NotifIcon({ type }: { type: Notification['type'] }) {
  const styles: React.CSSProperties = {
    width: 32, height: 32, borderRadius: '50%', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };
  switch (type) {
    case 'like':    return <div style={{ ...styles, background: 'rgba(254,44,85,0.15)' }}><Heart size={15} fill="var(--primary)" color="var(--primary)" /></div>;
    case 'comment': return <div style={{ ...styles, background: 'rgba(96,165,250,0.15)' }}><MessageCircle size={15} color="#60a5fa" /></div>;
    case 'repost':  return <div style={{ ...styles, background: 'rgba(52,211,153,0.15)' }}><Repeat2 size={15} color="#34d399" /></div>;
    case 'follow':  return <div style={{ ...styles, background: 'rgba(167,139,250,0.15)' }}><UserPlus size={15} color="#a78bfa" /></div>;
  }
}

function notifText(n: Notification): string {
  const addr = n.actor;
  const short = `@${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  switch (n.type) {
    case 'like':    return `${short} liked your video`;
    case 'comment': return `${short} commented: "${n.commentText?.substring(0, 50) || ''}${(n.commentText?.length || 0) > 50 ? '…' : ''}"`;
    case 'repost':  return `${short} reposted your video`;
    case 'follow':  return `${short} started following you`;
  }
}

export default function NotificationsPanel({ mode = 'sidebar' }: { mode?: 'sidebar' | 'bottom-nav' }) {
  const shelbyClient = useShelbyClient();
  const { account, connected } = useWallet();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const notifs = await fetchNotifications(shelbyClient, account.address.toString());
      setNotifications(notifs);
      setUnreadCount(notifs.filter(n => n.isNew).length);
    } catch (e) {
      console.error('[Notifications] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [shelbyClient, account?.address]);

  useEffect(() => {
    if (connected && account) {
      load();
      const interval = setInterval(load, 60000); // Refresh every minute
      return () => clearInterval(interval);
    }
  }, [connected, account?.address]);

  const handleOpen = () => {
    setOpen(true);
    markNotificationsRead();
    setNotifications(prev => prev.map(n => ({ ...n, isNew: false })));
    setUnreadCount(0);
  };

  if (!connected) return null;

  return (
    <>
      {/* Trigger Button */}
      {mode === 'sidebar' ? (
        <button className="notif-bell-btn" onClick={handleOpen} title="Notifications">
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>
      ) : (
        <button className="bottom-nav-item" onClick={handleOpen} style={{ background: 'none', border: 'none', padding: 0 }}>
          <div style={{ position: 'relative' }}>
            <Bell size={24} />
            {unreadCount > 0 && (
              <span className="notif-badge" style={{ top: '-4px', right: '-4px' }}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <span>Inbox</span>
        </button>
      )}

      {/* Overlay + Panel */}
      {open && (
        <div className="notif-overlay" onClick={() => setOpen(false)}>
          <div className="notif-panel" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="notif-header">
              <h3 className="notif-title">Notifications</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={e => { e.stopPropagation(); load(); }}
                  className="comments-close-btn"
                  title="Refresh"
                  disabled={loading}
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
                <button className="comments-close-btn" onClick={() => setOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="notif-list">
              {loading && notifications.length === 0 ? (
                <div className="notif-empty">
                  <Loader2 size={30} className="animate-spin" style={{ opacity: 0.4 }} />
                  <p style={{ opacity: 0.4, fontSize: '0.85rem' }}>Loading...</p>
                </div>
              ) : notifications.length === 0 ? (
                <div className="notif-empty">
                  <span style={{ fontSize: '2.5rem' }}>🔔</span>
                  <p style={{ opacity: 0.4, fontSize: '0.85rem' }}>No notifications yet</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div key={n.id} className={`notif-item${n.isNew ? ' notif-item-new' : ''}`}>
                    <NotifIcon type={n.type} />
                    <div className="notif-body">
                      <p className="notif-text">{notifText(n)}</p>
                      {n.timestamp > 0 && (
                        <span className="notif-time">{formatTime(n.timestamp)}</span>
                      )}
                    </div>
                    {n.isNew && <div className="notif-dot" />}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
