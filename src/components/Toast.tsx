import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Info, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000 }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onClose, 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success': return <CheckCircle size={20} style={{ color: '#22c55e' }} />;
      case 'error': return <XCircle size={20} style={{ color: '#ef4444' }} />;
      case 'warning': return <AlertCircle size={20} style={{ color: '#f59e0b' }} />;
      default: return <Info size={20} style={{ color: '#3b82f6' }} />;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'success': return 'rgba(34, 197, 94, 0.3)';
      case 'error': return 'rgba(239, 68, 68, 0.3)';
      case 'warning': return 'rgba(245, 158, 11, 0.3)';
      default: return 'rgba(59, 130, 246, 0.3)';
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 20px',
      backgroundColor: 'rgba(24, 24, 27, 0.9)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: `1px solid ${getBorderColor()}`,
      borderRadius: '16px',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
      color: 'white',
      fontSize: '14px',
      fontWeight: '500',
      minWidth: '280px',
      maxWidth: '400px',
      animation: isExiting ? 'toastSlideOut 0.3s ease-in forwards' : 'toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      pointerEvents: 'auto'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {getIcon()}
      </div>
      <div style={{ flexGrow: 1, lineHeight: '1.4' }}>{message}</div>
      <button 
        onClick={() => { setIsExiting(true); setTimeout(onClose, 300); }} 
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'rgba(255,255,255,0.3)',
          transition: 'color 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
        onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
      >
        <X size={16} />
      </button>
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes toastSlideOut {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(-20px); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default Toast;
