import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAptosSocial } from '../hooks/useAptosSocial';
import { useToast } from './ToastContext';
import { Upload as UploadIcon, X, CheckCircle2, Film, Image as ImageIcon, Camera } from 'lucide-react';
// No specific types needed here yet, but ensuring it follows the architecture

const MAX_VIDEO_SIZE_MB = 100;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

export default function Upload() {
  const { account, handleUploadVideo, isActionLoading } = useAptosSocial();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [uploadStage, setUploadStage] = useState<'idle' | 'reading' | 'signing' | 'confirming'>('idle');
  const videoPreviewUrl = useMemo(() => file ? URL.createObjectURL(file) : '', [file]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  const createLocalCoverDataUrl = (
    source: CanvasImageSource,
    width: number,
    height: number,
    quality = 0.72
  ) => {
    const maxSide = 720;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const isVideo = selectedFile.type.startsWith('video/') || 
                      /\.(mp4|mov|mkv|webm|avi|flv)$/i.test(selectedFile.name);
      
      if (!isVideo) {
        showToast("Please select a valid video file", 'warning');
        e.target.value = '';
        return;
      }
      setFile(selectedFile);
      setCoverPreview(null);
      generateThumbnail(selectedFile);
    }
  };

  const generateThumbnail = (videoFile: File) => {
    const video = document.createElement('video');
    const videoUrl = URL.createObjectURL(videoFile);
    video.src = videoUrl;
    video.muted = true;
    video.playsInline = true;
    video.currentTime = 1; // Seek to 1 second
    video.onloadeddata = () => {
      setCoverPreview(createLocalCoverDataUrl(video, video.videoWidth, video.videoHeight, 0.7));
      URL.revokeObjectURL(videoUrl);
    };
  };

  const captureCurrentFrame = () => {
    const video = document.getElementById('upload-video-preview') as HTMLVideoElement;
    if (!video) return;

    setCoverPreview(createLocalCoverDataUrl(video, video.videoWidth, video.videoHeight, 0.8));
    showToast("Frame captured as local cover!", 'success');
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const image = new Image();
      const imageUrl = URL.createObjectURL(file);
      image.onload = () => {
        setCoverPreview(createLocalCoverDataUrl(image, image.naturalWidth, image.naturalHeight));
        URL.revokeObjectURL(imageUrl);
      };
      image.src = imageUrl;
    }
  };

  const handleUpload = async () => {
    if (!account) {
      showToast("Please connect your wallet", 'warning');
      return;
    }
    if (!file) {
      showToast("Please select a file to upload", 'warning');
      return;
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      showToast(`File is too large! Maximum limit is ${MAX_VIDEO_SIZE_MB}MB.`, 'error');
      return;
    }

    try {
      setUploadStage('reading');
      // Step 1: Just reading is enough, handleUploadVideo does the rest
      setUploadStage('signing');
      
      const uploadedBlobName = await handleUploadVideo(file, description);
      await queryClient.invalidateQueries({ queryKey: ['globalBlobs'] });
      queryClient.removeQueries({ queryKey: ['globalBlobs'], exact: true });
      if (description.trim()) {
        try {
          localStorage.setItem(`shelby-caption:${uploadedBlobName}`, description.trim());
        } catch (storageError) {
          console.warn("Could not save local caption:", storageError);
        }
      }
      if (coverPreview) {
        try {
          localStorage.setItem(`shelby-cover:${uploadedBlobName}`, coverPreview);
        } catch (storageError) {
          console.warn("Could not save local cover:", storageError);
          showToast("Video uploaded, but local cover could not be saved on this device.", 'warning');
        }
      }

      setUploadStage('confirming');
      setTimeout(() => {
        showToast("Upload complete!", 'success');
        setFile(null);
        setCoverPreview(null);
        setDescription('');
        setUploadStage('idle');
        navigate('/');
      }, 800);
    } catch (err: any) {
      console.error("Catch Error:", err);
      showToast("Error uploading: " + (err.message || "Unknown error"), 'error');
      setUploadStage('idle');
    }
  };

  return (
    <div className="upload-page">
      <div className="upload-card">
        <div className="upload-header">
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Post Video</h1>
          {file && (
            <button 
              onClick={() => { setFile(null); setCoverPreview(null); }} 
              className="upload-close-btn"
              aria-label="Clear selected video"
            >
              <X size={20} color="white" />
            </button>
          )}
        </div>
        
        <label className={`upload-dropzone ${!file ? 'cursor-pointer' : ''}`}>
          <input type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileChange} disabled={!!file} />
          
          {!file ? (
            <div className="flex flex-col items-center text-center p-8">
              <div className="upload-icon-pulse mb-4">
                <UploadIcon size={48} color="var(--primary)" />
              </div>
              <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'white' }}>Select video to upload</p>
              <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginTop: '0.5rem' }}>
                MP4, WebM or MOV recommended
              </p>
            </div>
          ) : (
            <div className="upload-video-preview">
              <video 
                id="upload-video-preview"
                src={videoPreviewUrl}
                controls
              />
              <div className="upload-ready-badge">
                <Film size={14} color="var(--secondary)" />
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Video Ready</span>
              </div>
            </div>
          )}
        </label>

        {file && (
          <div className="upload-file-layout">
            <div className="upload-cover-panel">
              <div className="upload-cover-header">
                <label className="upload-field-label">Cover Image</label>
                <button 
                  onClick={captureCurrentFrame}
                  className="upload-capture-btn"
                >
                  <Camera size={12} />
                  <span style={{ fontSize: '10px', fontWeight: 800 }}>CAPTURE FRAME</span>
                </button>
              </div>
              <div className="upload-cover-preview">
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover" />
                ) : (
                  <div className="upload-cover-empty">
                    <ImageIcon size={24} />
                    <span className="text-[10px] font-bold">No Cover</span>
                  </div>
                )}
                <label className="upload-cover-change">
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} />
                  <div className="flex flex-col items-center gap-1">
                    <Camera size={20} color="white" />
                    <span className="text-[10px] font-bold text-white">Change</span>
                  </div>
                </label>
              </div>
              <p className="upload-cover-note">Cover stays on this device only. It is not uploaded to Shelby.</p>
            </div>

            <div className="upload-caption-panel">
              <label className="upload-field-label">Caption</label>
              <textarea 
                className="caption-textarea"
                placeholder="Write a message for your video..."
                value={description}
                onChange={(e) => setDescription(e.target.value.substring(0, 500))}
                maxLength={500}
              />
              <div className="flex justify-end pr-1">
                <span style={{ fontSize: '10px', fontWeight: 700, opacity: description.length >= 500 ? 1 : 0.3, color: description.length >= 500 ? 'var(--primary)' : 'inherit' }}>
                  {description.length}/500
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="upload-actions">
          {uploadStage !== 'idle' && (
            <div className="upload-progress-container mb-4">
              <div className="flex justify-between items-end mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-primary animate-pulse w-full flex justify-between">
                  <span>
                    {uploadStage === 'reading' && "Reading Video..."}
                    {uploadStage === 'signing' && "Waiting for Wallet... (Check your wallet popup!)"}
                    {uploadStage === 'confirming' && "Confirming on Network..."}
                  </span>
                  <span className="opacity-40">
                    {uploadStage === 'reading' && "25%"}
                    {uploadStage === 'signing' && "60%"}
                    {uploadStage === 'confirming' && "90%"}
                  </span>
                </span>
              </div>
              <div className="upload-progress-bar">
                <div 
                  className="upload-progress-fill" 
                  style={{ 
                    width: 
                      uploadStage === 'reading' ? '25%' : 
                      uploadStage === 'signing' ? '60%' : 
                      uploadStage === 'confirming' ? '90%' : '0%' 
                  }} 
                />
              </div>
            </div>
          )}

          <button 
            className="btn-premium" 
            onClick={handleUpload} 
            disabled={!file || isActionLoading}
          >
            {isActionLoading ? (
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span>Processing...</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} />
                <span>Publish to Shelby Clip</span>
              </div>
            )}
          </button>
          
          <p style={{ fontSize: '0.75rem', textAlign: 'center', opacity: 0.4 }}>
            By posting, you agree to store this content permanently on the Shelby network.
          </p>
        </div>
      </div>
    </div>
  );
}
