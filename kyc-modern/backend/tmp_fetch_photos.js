const http = require('http');
const fs = require('fs');
const types = ['recto','verso','live'];
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtYXRyaWN1bGUiOiJNQVQwMDEiLCJyb2xlIjoiYWdlbnQiLCJqdGkiOiJiYjEyZjEwYjNmZjJiZWM0NTUyMjEwYjVmN2JmNGI3YyIsImlhdCI6MTc4NDA0MzEwMCwiZXhwIjoxNzg0MDcxOTAwfQ.8PLfW0Ea1TKG6jSDA4wxFbFCe97K6lyc_uXg7LbSlrM';

(async()=>{
  for (const t of types) {
    const url = `http://127.0.0.1:3001/api/dossiers/KYC1784037151632DE47B5/photo/${t}?token=${token}`;
    console.log('Fetching', url);
    await new Promise((resolve)=>{
      http.get(url, (res)=>{
        console.log(t, 'status', res.statusCode);
        if (res.statusCode === 200) {
          const out = `photo-${t}.jpg`;
          const ws = fs.createWriteStream(out);
          res.pipe(ws);
          ws.on('finish', ()=>{ console.log('Saved', out); resolve(); });
          ws.on('error', (e)=>{ console.error('Write error', e); resolve(); });
        } else {
          let body = '';
          res.on('data', chunk=> body += chunk.toString());
          res.on('end', ()=>{ console.log('Body:', body); resolve(); });
        }
      }).on('error', (e)=>{ console.error('Request error', e); resolve(); });
    });
  }
  console.log('Done');
})();
