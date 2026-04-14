import { Buffer } from 'buffer';
import { useState } from 'react';
import { useUploadBlobs } from '@shelby-protocol/react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Upload as UploadIcon, X, CheckCircle2, Film } from 'lucide-react';

export default function Upload() {
  const { account, signAndSubmitTransaction } = useWallet();
  const uploadBlobs = useUploadBlobs({});
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [uploadStage, setUploadStage] = useState<'idle' | 'reading' | 'signing' | 'confirming'>('idle');
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const isVideo = selectedFile.type.startsWith('video/') || 
                      /\.(mp4|mov|mkv|webm|avi|flv)$/i.test(selectedFile.name);
      
      if (!isVideo) {
        alert("Please select a valid video file (mp4, mov, mkv, webm, etc.)");
        e.target.value = '';
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!account || !signAndSubmitTransaction) {
      alert("Please connect your wallet");
      return;
    }
    if (!file) {
      alert("Please select a file to upload");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      alert("File is too large! Maximum limit is 20MB to prevent wallet crashes.");
      return;
    }

    try {
      setUploadStage('reading');
      const fileData = new Uint8Array(await file.arrayBuffer());
      
      setUploadStage('signing');
      // Limit randomId to 4 chars to save precious bytes for the on-chain limit (128 bytes total).
      const randomId = Math.random().toString(36).substring(2, 6);
      const timestamp = Math.floor(Date.now() / 1000); // use seconds instead of ms to save 3 bytes
      
      // Encode description into Base64URL manually to ensure NO slashes are generated
      // Max 60 characters so base64 string + prefix keeps the blob_name well under 128 bytes!
      const safeDesc = description.replace(/[:/]/g, ' ').substring(0, 60);
      const encodedDesc = Buffer.from(safeDesc).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const safeBlobName = `shelby-clip/${timestamp}_${randomId}.mp4:::b64:${encodedDesc}`;

      uploadBlobs.mutate({
        signer: { account, signAndSubmitTransaction },
        blobs: [{ blobName: safeBlobName, blobData: fileData }],
        expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000), 
      }, {
        onSuccess: () => {
          setUploadStage('confirming');
          setTimeout(() => {
            alert("Upload complete!");
            setFile(null);
            setDescription('');
            setUploadStage('idle');
          }, 800);
        },
        onError: (e: any) => {
          console.error("Upload Error:", e);
          alert("Upload failed: " + (e.message || "Unknown error"));
          setUploadStage('idle');
        }
      });
    } catch (err: any) {
      console.error("Catch Error:", err);
      alert("Error reading file: " + (err.message || "Unknown error"));
      setUploadStage('idle');
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-black p-4">
      <div className="upload-card">
        <div className="flex justify-between items-center mb-6">
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Post Video</h1>
          {file && (
            <button 
              onClick={() => setFile(null)} 
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
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
            <div className="relative w-full h-[350px] rounded-lg overflow-hidden bg-black/40">
              <video src={URL.createObjectURL(file)} className="w-full h-full object-contain" />
              <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md p-2 rounded-lg flex items-center gap-2 border border-white/10">
                <Film size={14} color="var(--secondary)" />
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Ready to post</span>
              </div>
            </div>
          )}
        </label>

        {file && (
          <div className="mt-6 flex flex-col gap-2">
            <label className="text-xs font-bold opacity-50 uppercase tracking-wider ml-1">Caption</label>
            <textarea 
              className="caption-textarea"
              placeholder="Write a message for your video..."
              value={description}
              onChange={(e) => setDescription(e.target.value.substring(0, 60))}
              maxLength={60}
            />
            <div className="flex justify-end pr-1">
              <span className={`text-[10px] font-bold ${description.length >= 60 ? 'text-primary' : 'opacity-30'}`}>
                {description.length}/60
              </span>
            </div>
          </div>
        )}

        <div className="mt-8 space-y-4">
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
            disabled={!file || uploadBlobs.isPending}
          >
            {uploadBlobs.isPending ? (
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
