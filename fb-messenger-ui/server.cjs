const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// Proxy fetch message attachments (per message, not per attachment ID)
app.get('/api/message-attachments/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const { token } = req.query;

  if (!token) return res.status(400).json({ error: 'Missing token' });

  const url =
    `https://graph.facebook.com/v19.0/${messageId}/attachments` +
    `?fields=id,type,image_data,video_data,file_url,name,mime_type` +
    `&access_token=${token}`;

  console.log('Fetching message attachments for:', messageId);

  try {
    const fbRes = await fetch(url);
    const data = await fbRes.json();

    console.log('Response:', JSON.stringify(data, null, 2));

    res.status(fbRes.status).json(data);
  } catch (e) {
    console.error('Message attachments proxy error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Proxy fetch attachment (legacy, may not be supported by Facebook)
app.get('/api/attachment/:id', async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;

  if (!token) return res.status(400).json({ error: 'Missing token' });

  const url =
    `https://graph.facebook.com/v19.0/${id}` +
    `?fields=id,type,mime_type,name,file_url,image_data,video_data` +
    `&access_token=${token}`;

  console.log('Fetching attachment URL:', url.substring(0, 80) + '...');

  try {
    const fbRes = await fetch(url);
    const data = await fbRes.json();

    console.log('Facebook response status:', fbRes.status);
    console.log('Facebook response body:', JSON.stringify(data, null, 2));

    res.status(fbRes.status).json(data);
  } catch (e) {
    console.error('Attachment proxy error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Proxy fetch image (để tránh CORS khi load ảnh)
app.get('/api/image', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Missing url');

  try {
    const imgRes = await fetch(decodeURIComponent(url));
    const contentType = imgRes.headers.get('content-type');
    if (contentType) res.set('Content-Type', contentType);
    imgRes.body.pipe(res);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.listen(3001, () => console.log('Proxy server running on port 3001'));
