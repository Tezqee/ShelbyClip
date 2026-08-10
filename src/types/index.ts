export interface Video {
  id: string;
  rawName: string;
  urls: string[];
  coverUrls?: string[];
  metadataUrls?: string[];
  account: string;
  description: string;
}

export interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  bio: string;
}

export interface Comment {
  text: string;
  author: string;
  timestamp: number;
  id: string;
}
