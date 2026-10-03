import { createApp } from './app.js';
import * as repository from './urlRepository.js';

const port = process.env.PORT || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

createApp({ repository, baseUrl }).listen(port, () => {
  console.log(`url-shortener listening on ${baseUrl}`);
});
