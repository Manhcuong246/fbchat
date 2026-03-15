const express = require('express');
const app = express();
app.use(express.json());

const VERIFY_TOKEN = 'my_webhook_token_123';

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message) {
          broadcast({
            type: 'new_message',
            conversationId: event.sender?.id,
            message: event.message,
          });
        }
      }
    }
  }
  res.sendStatus(200);
});

const clients = new Set();
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => {
    try {
      client.write(msg);
    } catch (_) {}
  });
}

app.listen(3001, () => console.log('Webhook server on port 3001'));
