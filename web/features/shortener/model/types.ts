export type ShortenInput = {
  url: string;
  alias?: string;
  expiresInSeconds?: number;
};

export type ShortenedUrl = {
  id: number;
  code: string;
  shortUrl: string;
  originalUrl: string;
  expiresAt: string | null;
};
