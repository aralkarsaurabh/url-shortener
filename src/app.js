import express from 'express';
import { BASE62_PATTERN } from './base62.js';

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function createApp({ repository, baseUrl }) {
  const app = express();
  app.use(express.json());

  app.post('/shorten', async (req, res, next) => {
    try {
      const { url } = req.body ?? {};
      if (!isHttpUrl(url)) {
        return res.status(400).json({ error: 'A valid http or https "url" is required' });
      }
      const code = await repository.createUrl(url);
      res.status(201).json({ code, shortUrl: `${baseUrl}/${code}` });
    } catch (err) {
      next(err);
    }
  });

  app.get('/:code', async (req, res, next) => {
    try {
      const { code } = req.params;
      const target = BASE62_PATTERN.test(code) ? await repository.findUrlByCode(code) : null;
      if (!target) return res.status(404).json({ error: 'Short URL not found' });
      res.redirect(302, target);
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
