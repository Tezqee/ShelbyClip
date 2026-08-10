import { useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Network } from '@aptos-labs/ts-sdk';
import { useShelbyClient, useUploadBlobs } from '@shelby-protocol/react';
import { ShelbyBlobClient } from '@shelby-protocol/sdk/browser';
import { 
  toggleLike, 
  repost, 
  getCommentBlobName, 
  encodeComment,
  checkIsVerified,
  FOLLOW_SIGNAL_TYPE,
  UNFOLLOW_SIGNAL_TYPE,
} from '../services/social';
import { aptos } from '../services/aptosClient';

const DEFAULT_SHELBY_CONTRACT_ADDRESS = "0x9ce0fd7ef60010764b6737ed49e1296fb5e34adad586b8ef33276b3ad67f808e";
const VERIFIED_BADGE_RENEW_SIGNAL_TYPE = 5;

// Named address from Move.toml. Override with VITE_SHELBY_CONTRACT_ADDRESS after deploying elsewhere.
export const SHELBY_CONTRACT_ADDRESS =
  import.meta.env.VITE_SHELBY_CONTRACT_ADDRESS || DEFAULT_SHELBY_CONTRACT_ADDRESS;

function getWalletNetworkUrl(network: unknown) {
  const value = network as { url?: string; fullnode?: string; fullnodeUrl?: string; nodeUrl?: string } | null;
  return value?.url || value?.fullnode || value?.fullnodeUrl || value?.nodeUrl || '';
}

function isAptosTestnetContractNetwork(network: unknown) {
  const value = network as { name?: string; chainId?: string | number } | null;
  const name = String(value?.name || '').toLowerCase();
  const url = getWalletNetworkUrl(network).toLowerCase();

  const isShelbyNet = url.includes('shelbynet.shelby.xyz') || name.includes('shelbynet');

  return isShelbyNet;
}

export function useAptosSocial() {
  const { account, signAndSubmitTransaction, connected, network, changeNetwork } = useWallet();
  const shelbyClient = useShelbyClient();
  const uploadBlobs = useUploadBlobs({});

  const ensureAptosTestnetContractNetwork = useCallback(async () => {
    if (isAptosTestnetContractNetwork(network)) return;

    try {
      await changeNetwork(Network.SHELBYNET as any);
      return;
    } catch {
      throw new Error(
        'Wrong wallet network. Switch your wallet to ShelbyNet (api.shelbynet.shelby.xyz), then try again.'
      );
    }
  }, [network, changeNetwork]);

  const handleToggleLike = useCallback(async (isLiked: boolean, videoHash: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    return await toggleLike(isLiked, videoHash, account, signAndSubmitTransaction, uploadBlobs);
  }, [connected, account, signAndSubmitTransaction, uploadBlobs]);

  const handleToggleFollow = useCallback(async (isFollowing: boolean, targetAddress: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    const nextFollowing = !isFollowing;
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::emit_social_signal`,
      typeArguments: [],
      functionArguments: [
        targetAddress,
        nextFollowing ? FOLLOW_SIGNAL_TYPE : UNFOLLOW_SIGNAL_TYPE,
        JSON.stringify({
          action: nextFollowing ? 'follow' : 'unfollow',
          target: targetAddress,
          timestamp: Date.now(),
        }),
      ],
    };
    await signAndSubmitTransaction({ data: payload });
    return nextFollowing;
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleRepost = useCallback(async (videoHash: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    return await repost(videoHash, account, signAndSubmitTransaction, uploadBlobs);
  }, [connected, account, signAndSubmitTransaction, uploadBlobs]);

  const handleAddComment = useCallback(async (videoHash: string, text: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    
    const ts = Date.now();
    const blobName = getCommentBlobName(videoHash, ts);
    const encoded = encodeComment(text);
    const blobData = new TextEncoder().encode(encoded);

    return await new Promise<void>((resolve, reject) => {
      uploadBlobs.mutate(
        {
          signer: { account, signAndSubmitTransaction },
          blobs: [{ blobName, blobData }],
          expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000),
          options: { selectedLocation: 'shelbynet-1' },
        },
        { onSuccess: () => resolve(), onError: (e: any) => reject(e) }
      );
    });
  }, [connected, account, signAndSubmitTransaction, uploadBlobs]);

  const handleUploadVideo = useCallback(async (file: File, description: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');

    await ensureAptosTestnetContractNetwork();
    const walletAddress = account.address.toString();
    const isRegistered = await checkIsVerified(aptos, SHELBY_CONTRACT_ADDRESS, walletAddress);
    if (!isRegistered) {
      await signAndSubmitTransaction({
        data: {
          function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::verify_user`,
          typeArguments: [],
          functionArguments: [],
        },
      });
    }
    
    const fileData = new Uint8Array(await file.arrayBuffer());
    const randomId = Math.random().toString(36).substring(2, 6);
    const timestamp = Math.floor(Date.now() / 1000);
    const safeDesc = description.replace(/[:/]/g, ' ').substring(0, 500);
    const videoId = `${timestamp}_${randomId}`;
    const blobName = `shelby-clip/${videoId}.mp4:::m`;
    const metadataBlobName = `shelby-clip/metadata/${videoId}.json`;
    const metadataData = new TextEncoder().encode(JSON.stringify({ description: safeDesc }));
    
    const blobs = [
      { 
        blobName,
        blobData: fileData 
      },
      {
        blobName: metadataBlobName,
        blobData: metadataData
      }
    ];

    return await new Promise<string>((resolve, reject) => {
      uploadBlobs.mutate(
        {
          signer: { account, signAndSubmitTransaction },
          blobs,
          expirationMicros: Date.now() * 1000 + (365 * 24 * 60 * 60 * 1000000),
          options: { selectedLocation: 'shelbynet-1' },
        },
        { onSuccess: () => resolve(blobName), onError: (e: any) => reject(e) }
      );
    });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction, uploadBlobs]);

  const handleDeleteVideo = useCallback(async (blobName: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    const payload = ShelbyBlobClient.createDeleteObjectPayload({ blobName });
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, signAndSubmitTransaction]);

  const handleTipCreator = useCallback(async (receiver: string, amount: number) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    
    // Amount in Octas (1 APT = 10^8 Octas)
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::tip_creator`,
      typeArguments: [],
      functionArguments: [receiver, amount],
    };

    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handlePurchaseVideo = useCallback(async (creator: string, videoId: string, price: number) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();

    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::purchase_video`,
      typeArguments: [],
      functionArguments: [creator, videoId, price],
    };

    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleEmitSocialSignal = useCallback(async (target: string, type: number, metadata: string) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();

    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::emit_social_signal`,
      typeArguments: [],
      functionArguments: [target, type, metadata],
    };

    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleSetVideoPrice = useCallback(async (videoId: string, priceOctas: number) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::set_video_price`,
      typeArguments: [],
      functionArguments: [videoId, priceOctas],
    };
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleSubscribe = useCallback(async (creator: string, priceOctas: number) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::subscribe`,
      typeArguments: [],
      functionArguments: [creator, priceOctas],
    };
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleSetSubscriptionPrice = useCallback(async (priceOctas: number) => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::set_subscription_price`,
      typeArguments: [],
      functionArguments: [priceOctas],
    };
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleVerifyUser = useCallback(async () => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::verify_user`,
      typeArguments: [],
      functionArguments: [],
    };
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleRenewVerifiedBadge = useCallback(async () => {
    if (!connected || !account) throw new Error('Wallet not connected');
    await ensureAptosTestnetContractNetwork();
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::emit_social_signal`,
      typeArguments: [],
      functionArguments: [
        account.address.toString(),
        VERIFIED_BADGE_RENEW_SIGNAL_TYPE,
        JSON.stringify({
          action: 'renew_verified_badge',
          owner: account.address.toString(),
          timestamp: Date.now(),
        }),
      ],
    };
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  const handleRecordView = useCallback(async (videoId: string) => {
    if (!connected || !account) return;
    await ensureAptosTestnetContractNetwork();
    const payload: any = {
      function: `${SHELBY_CONTRACT_ADDRESS}::shelby_social::record_view`,
      typeArguments: [],
      functionArguments: [videoId],
    };
    return await signAndSubmitTransaction({ data: payload });
  }, [connected, account, ensureAptosTestnetContractNetwork, signAndSubmitTransaction]);

  return {
    connected,
    account,
    network,
    shelbyClient,
    aptos,
    handleToggleLike,
    handleToggleFollow,
    handleRepost,
    handleAddComment,
    handleUploadVideo,
    handleDeleteVideo,
    handleTipCreator,
    handlePurchaseVideo,
    handleSetVideoPrice,
    handleSubscribe,
    handleSetSubscriptionPrice,
    handleVerifyUser,
    handleRenewVerifiedBadge,
    handleRecordView,
    handleEmitSocialSignal,
    signAndSubmitTransaction,
    uploadBlobs,
    isActionLoading: uploadBlobs.isPending
  };
}
