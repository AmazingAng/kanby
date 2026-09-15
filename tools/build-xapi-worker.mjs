import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const clientDir = join(root, 'dist-xapi/client');
const outputDir = join(root, 'dist-xapi');
const outputFile = join(outputDir, 'worker.mjs');

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function readAsset(path) {
  let contents = readFileSync(path);
  if (extname(path) === '.html') {
    const html = contents.toString('utf8');
    const assetLoader = `<script type="module">
      const base = location.pathname.endsWith('/') ? location.pathname : location.pathname + '/';
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = base + 'app.css';
      document.head.append(stylesheet);
      import(base + 'app.js');
    </script>`;
    contents = Buffer.from(
      html
        .replace(/\s*<script[^>]+src="\/app\.js"><\/script>/, '')
        .replace(/\s*<link[^>]+href="\/app\.css"[^>]*>/, '')
        .replace('</head>', `${assetLoader}</head>`),
    );
  }
  return contents;
}

const assets = Object.fromEntries(
  walk(clientDir).map((path) => {
    const key = '/' + relative(clientDir, path).replaceAll('\\', '/');
    const encoded = gzipSync(readAsset(path), { level: 9 }).toString('base64');
    return [key, { body: encoded, type: contentTypes[extname(path)] ?? 'application/octet-stream' }];
  }),
);

const runtime = `const ASSETS=${JSON.stringify(assets)};
const decoder=(value)=>{const raw=atob(value);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes};
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
async function d1Request(request,env,url){
  if(!env.DB)return json({error:'DB binding unavailable'},503);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS xapi_acceptance_events (id TEXT PRIMARY KEY, object_key TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  if(request.method==='POST'){
    const id=crypto.randomUUID();const key='d1-only/'+id;
    await env.DB.prepare('INSERT INTO xapi_acceptance_events (id,object_key,created_at) VALUES (?,?,?)').bind(id,key,new Date().toISOString()).run();
    return json({ok:true,id,key},201);
  }
  if(request.method==='DELETE'){
    const id=url.searchParams.get('id');if(!id)return json({error:'id is required'},400);
    await env.DB.prepare('DELETE FROM xapi_acceptance_events WHERE id=?').bind(id).run();return json({ok:true,id});
  }
  const rows=await env.DB.prepare('SELECT id,object_key,created_at FROM xapi_acceptance_events ORDER BY created_at DESC LIMIT 20').all();
  return json({ok:true,d1:rows.results});
}
async function resourceRequest(request,env,url){
  if(!env.DB||!env.ATTACHMENTS)return json({error:'Required xAPI bindings unavailable',bindings:{DB:Boolean(env.DB),ATTACHMENTS:Boolean(env.ATTACHMENTS)}},503);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS xapi_acceptance_events (id TEXT PRIMARY KEY, object_key TEXT NOT NULL, created_at TEXT NOT NULL)').run();
  if(request.method==='POST'){
    const id=crypto.randomUUID();const key='acceptance/'+id+'.txt';const body='Kanby xAPI Workers '+new Date().toISOString();
    await env.ATTACHMENTS.put(key,body,{httpMetadata:{contentType:'text/plain; charset=utf-8'},customMetadata:{source:'kanby-xapi-acceptance'}});
    await env.DB.prepare('INSERT INTO xapi_acceptance_events (id,object_key,created_at) VALUES (?,?,?)').bind(id,key,new Date().toISOString()).run();
    return json({ok:true,id,key},201);
  }
  if(request.method==='DELETE'){
    const id=url.searchParams.get('id');if(!id)return json({error:'id is required'},400);
    const row=await env.DB.prepare('SELECT object_key FROM xapi_acceptance_events WHERE id=?').bind(id).first();
    if(!row)return json({error:'not found'},404);
    await env.ATTACHMENTS.delete(row.object_key);await env.DB.prepare('DELETE FROM xapi_acceptance_events WHERE id=?').bind(id).run();
    return json({ok:true,id});
  }
  const rows=await env.DB.prepare('SELECT id,object_key,created_at FROM xapi_acceptance_events ORDER BY created_at DESC LIMIT 20').all();
  const objects=await env.ATTACHMENTS.list({prefix:'acceptance/',limit:20});
  return json({ok:true,d1:rows.results,r2:objects.objects.map(({key,size})=>({key,size}))});
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api/xapi/health')return json({ok:true,app:'kanby',runtime:'xapi-workers',bindings:{DB:Boolean(env.DB),ATTACHMENTS:Boolean(env.ATTACHMENTS)}});
  if(url.pathname==='/api/xapi/d1')return d1Request(request,env,url);
  if(url.pathname==='/api/xapi/resources')return resourceRequest(request,env,url);
  const key=ASSETS[url.pathname]?url.pathname:'/index.html';const asset=ASSETS[key];
  const body=new Blob([decoder(asset.body)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(body,{headers:{'content-type':asset.type,'cache-control':key==='/index.html'?'no-cache':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'}});
}};
`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputFile, runtime);
const bytes = statSync(outputFile).size;
console.log(JSON.stringify({ outputFile, bytes, assets: Object.keys(assets).length }));
if (bytes > 1_000_000) throw new Error(`xAPI Worker artifact exceeds 1 MB: ${bytes}`);
