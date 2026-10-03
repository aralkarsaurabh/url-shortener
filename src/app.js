import express from 'express';
import { shortenSchema, CODE_PATTERN } from './schemas.js';
import { AliasTakenError } from './errors.js';

// Every error looks the same: { error: { code, message, details? } }
function sendError(res, status, code, message, details) {
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
}

const notFound = (res) => sendError(res, 404, 'NOT_FOUND', 'Short URL not found');

export function createApp({ service, baseUrl }) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  app.post('/shorten', async (req, res, next) => {
    try {
      const parsed = shortenSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const details = parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
        return sendError(res, 400, 'VALIDATION_ERROR', 'The request is not valid', details);
      }
      const { code, expiresAt } = await service.createUrl(parsed.data);
      res.status(201).json({ code, shortUrl: `${baseUrl}/${code}`, expiresAt });
    } catch (err) {
      if (err instanceof AliasTakenError) {
        return sendError(res, 409, 'ALIAS_TAKEN', 'That alias is already in use');
      }
      next(err);
    }
  });

  app.get('/:code', async (req, res, next) => {
    try {
      const { code } = req.params;
      if (!CODE_PATTERN.test(code)) return notFound(res);
      const result = await service.visit(code);
      if (result.status === 'found') return res.redirect(302, result.url);
      if (result.status === 'gone') {
        return sendError(res, 410, 'LINK_EXPIRED', 'This short URL has expired');
      }
      notFound(res);
    } catch (err) {
      next(err);
    }
  });

  // Reads straight from the database so the numbers are always current.
  app.get('/stats/:code', async (req, res, next) => {
    try {
      const { code } = req.params;
      const stats = CODE_PATTERN.test(code) ? await service.getStats(code) : null;
      if (!stats) return notFound(res);
      res.json(stats);
    } catch (err) {
      next(err);
    }
  });

  app.use((req, res) => sendError(res, 404, 'NOT_FOUND', 'Route not found'));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON');
    }
    if (err.type === 'entity.too.large') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
    }
    console.error(err);
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  });

  return app;
}
