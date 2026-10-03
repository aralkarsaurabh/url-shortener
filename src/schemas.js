import { z } from 'zod';

export const MAX_URL_LENGTH = 2048;
export const MAX_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

// What GET /:code accepts. Anything else is a 404 without touching Redis or the database.
export const CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

const ALIAS_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const RESERVED_ALIASES = new Set(['shorten', 'stats', 'health', 'api']);

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    const okScheme = url.protocol === 'http:' || url.protocol === 'https:';
    return okScheme && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const shortenSchema = z.object({
  url: z
    .string({ error: 'url is required' })
    .trim()
    .max(MAX_URL_LENGTH, `url must be at most ${MAX_URL_LENGTH} characters`)
    .refine(isAllowedUrl, 'url must be a valid http or https address without a username or password'),
  alias: z
    .string({ error: 'alias must be text' })
    .regex(ALIAS_PATTERN, 'alias must be 3 to 32 characters: letters, numbers, - and _')
    .refine((alias) => !RESERVED_ALIASES.has(alias.toLowerCase()), 'that alias is reserved')
    .optional(),
  expiresInSeconds: z
    .number({ error: 'expiresInSeconds must be a number' })
    .int('expiresInSeconds must be a whole number')
    .min(1, 'expiresInSeconds must be at least 1')
    .max(MAX_EXPIRY_SECONDS, `expiresInSeconds must be at most ${MAX_EXPIRY_SECONDS} (one year)`)
    .optional(),
});
