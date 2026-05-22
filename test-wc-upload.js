// Standalone test: WeChat Channels CDN upload
// Usage: node test-wc-upload.js <cookie>

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cookie = process.argv[2] || '';

function httpsRequest(method, hostname, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, port: 443, path: urlPath, method,
      rejectUnauthorized: false,
      headers: { ...headers }
    };
    if (body) {
      const buf = typeof body === 'string' ? Buffer.from(body) : body;
      opts.headers['Content-Length'] = buf.length;
    }
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')) });
    if (body) {
      const buf = typeof body === 'string' ? Buffer.from(body) : body;
      req.write(buf);
    }
    req.end();
  });
}

async function run() {
  // Step 1: Get authKey
  console.log('=== Step 1: Get authKey ===');
  const paramsBody = JSON.stringify({
    timestamp: Date.now().toString().substring(0, 13),
    _log_finder_id: '',
    rawKeyBuff: null
  });
  const paramsResp = await httpsRequest('POST', 'channels.weixin.qq.com',
    '/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params', paramsBody, {
      'Cookie': cookie,
      'Content-Type': 'application/json',
      'Referer': 'https://channels.weixin.qq.com/platform/post/create',
      'Origin': 'https://channels.weixin.qq.com',
      'Accept': 'application/json, text/plain, */*'
    });
  console.log('Status:', paramsResp.status);
  console.log('Response:', paramsResp.data.substring(0, 300));

  const paramsData = JSON.parse(paramsResp.data);
  if (paramsData.errCode !== 0 || !paramsData.data?.authKey) {
    console.error('Failed to get authKey');
    return;
  }
  const authKey = paramsData.data.authKey;
  const uin = paramsData.data.uin;
  console.log('authKey:', authKey.substring(0, 40) + '...');
  console.log('uin:', uin);

  // Test file
  const testFile = 'D:/PC APP/test-video.mp4'; // Adjust path
  if (!fs.existsSync(testFile)) {
    console.log('No test file found, testing with applyuploaddfs only');
  }

  const fileSize = fs.existsSync(testFile) ? fs.statSync(testFile).size : 44194755;
  const fileName = fs.existsSync(testFile) ? path.basename(testFile) : 'test.mp4';

  // Step 2: Test applyuploaddfs with different BlockSum values
  console.log('\n=== Step 2: Test applyuploaddfs ===');

  const CHUNK = 8388608;
  // Yixiaoer's actual logic: cumulative byte positions
  const yxBlockSum = Math.ceil(fileSize/CHUNK);
  const yxBlockPartLength = [];
  for (let z = 1; z <= yxBlockSum; z++) {
    if (z * CHUNK <= fileSize) yxBlockPartLength.push(z * CHUNK);
    else { yxBlockPartLength.push(fileSize); break; }
  }
  const tests = [
    { name: 'BlockSum=1, single block', BlockSum: 1, BlockPartLength: [fileSize] },
    { name: 'BlockSum=ceil, chunk sizes', BlockSum: Math.ceil(fileSize/CHUNK), BlockPartLength: [...Array(Math.ceil(fileSize/CHUNK)-1).fill(CHUNK), fileSize - (Math.ceil(fileSize/CHUNK)-1)*CHUNK] },
    { name: 'BlockSum=ceil, YIXIAOER cumulative format', BlockSum: yxBlockSum, BlockPartLength: yxBlockPartLength },
  ];

  for (const t of tests) {
    const body = JSON.stringify({ BlockSum: t.BlockSum, BlockPartLength: t.BlockPartLength });
    const taskId = Date.now().toString();
    const xArgs = `apptype=251&filetype=20302&weixinnum=${uin}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=2`;

    console.log(`\n--- ${t.name} ---`);
    console.log('Body:', body);
    console.log('X-Arguments:', xArgs);

    try {
      const resp = await httpsRequest('PUT', 'finderassistancea.video.qq.com', '/applyuploaddfs', body, {
        'X-Arguments': xArgs,
        'Authorization': authKey,
        'Content-Type': 'application/json',
        'Content-MD5': 'null',
        'Referer': 'https://channels.weixin.qq.com/',
        'Origin': 'https://channels.weixin.qq.com/',
        'Accept': '*/*'
      });
      console.log('Status:', resp.status);
      console.log('Response:', resp.data.substring(0, 300));

      if (resp.data.includes('UploadID')) {
        const parsed = JSON.parse(resp.data);
        console.log('UploadID:', parsed.UploadID);

        // Step 3: Test uploadpartdfs with this UploadID
        if (fs.existsSync(testFile)) {
          console.log('\n=== Step 3: Test uploadpartdfs ===');
          const fileBuf = fs.readFileSync(testFile);
          const chunk = fileBuf.subarray(0, Math.min(CHUNK, fileBuf.length));
          const md5 = crypto.createHash('md5').update(chunk).digest('hex');

          const uploadXArgs = `apptype=251&filetype=20302&weixinnum=${uin}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=0`;
          const uploadPath = `/uploadpartdfs?PartNumber=1&UploadID=${parsed.UploadID}`;

          console.log('Upload path:', uploadPath);
          console.log('Chunk size:', chunk.length);

          const uploadResp = await httpsRequest('PUT', 'finderassistancea.video.qq.com', uploadPath, chunk, {
            'Content-Type': 'application/octet-stream',
            'Content-MD5': md5,
            'X-Arguments': uploadXArgs,
            'Authorization': authKey,
            'Referer': 'https://channels.weixin.qq.com/platform/post/create',
            'Origin': 'https://channels.weixin.qq.com',
            'Accept': '*/*'
          });
          console.log('Upload status:', uploadResp.status);
          console.log('Upload response:', uploadResp.data.substring(0, 300));
        }
      }
    } catch (e) {
      console.log('Error:', e.message);
    }
  }
}

run().catch(console.error);
