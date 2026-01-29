const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json({ limit: '2mb' }));

// 添加 CORS 头，允许浏览器直接访问本地代理
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.post('/proxy', async (req, res) => {
  const { url, method = 'GET', headers = {}, body } = req.body || {};
  
  // 调试日志
  console.log('Proxy request:');
  console.log('  URL:', url);
  console.log('  Method:', method);
  console.log('  Headers:', headers);
  console.log('  Body:', body);
  
  if (!url) {
    console.log('ERROR: missing url');
    return res.status(400).send('missing url');
  }
  
  try {
    const opts = { method, headers: headers || {} };
    if (body !== undefined && body !== null && body !== '') {
      // 如果 body 是 JSON 字符串，直接发送；如果是对象，转换为 JSON
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      // 如果 headers 中没有 content-type，则默认设置为 JSON
      const hasContentType = Object.keys(opts.headers).some(h => h.toLowerCase() === 'content-type');
      if (!hasContentType) {
        opts.headers['Content-Type'] = 'application/json';
      }
    }

    console.log('Forwarding request to:', url);
    console.log('Options:', opts);
    
    const upstream = await fetch(url, opts);
    const text = await upstream.text();
    
    console.log('Response status:', upstream.status);
    // 将上游的状态码和响应体返回给调用者
    res.status(upstream.status).send(text);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error: ' + String(err));
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proxy server listening on http://localhost:${port}`));
