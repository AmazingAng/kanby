import { gzipSync } from 'node:zlib';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const serverEntry = join(root, 'dist/server/index.js');
const clientDir = join(root, 'dist/client');
const outputDir = join(root, 'dist-xapi-full');
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') ?? '';

if (!basePath.startsWith('/w/') || !basePath.endsWith('/preview')) {
  throw new Error('NEXT_PUBLIC_BASE_PATH must be the xAPI preview route');
}

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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

await build({
  configFile: false,
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    target: 'es2022',
    ssr: true,
    outDir: outputDir,
    emptyOutDir: false,
    minify: true,
    lib: { entry: serverEntry, formats: ['es'] },
    rolldownOptions: {
      external: [/^node:/, /^cloudflare:/],
      output: { codeSplitting: false, entryFileNames: 'application.js' },
    },
  },
});

const applicationPath = join(outputDir, 'application.js');
const applicationSource = readFileSync(applicationPath, 'utf8').replace(
  /import\(t\.join\(r,\s*"cjs\/react-dom-server\.edge\.development\.js"\)\)/g,
  'import("node:path")',
);
writeFileSync(applicationPath, applicationSource);

const assets = Object.fromEntries(
  walk(clientDir).flatMap((path) => {
    const key = '/' + relative(clientDir, path).replaceAll('\\', '/');
    const asset = {
      body: gzipSync(readFileSync(path), { level: 9 }).toString('base64'),
      type: contentTypes[extname(path)] ?? 'application/octet-stream',
    };
    const keys = key.startsWith(`${basePath}/`)
      ? [key, key.slice(basePath.length)]
      : [key];
    return keys.map((assetKey) => [assetKey, asset]);
  }),
);

writeFileSync(
  join(outputDir, 'assets.js'),
  `const ASSETS=${JSON.stringify(assets)};
const decode=(value)=>{const raw=atob(value);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes};
export async function fetchAsset(request){
  const url=new URL(request.url);const asset=ASSETS[url.pathname];
  if(!asset)return new Response('Not found',{status:404});
  const body=new Blob([decode(asset.body)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const immutable=url.pathname.includes('/_next/static/');
  return new Response(body,{headers:{'content-type':asset.type,'cache-control':immutable?'public, max-age=31536000, immutable':'public, max-age=3600','x-content-type-options':'nosniff'}});
}
`,
);

const migrations = walk(join(root, 'drizzle'))
  .filter((path) => path.endsWith('.sql'))
  .sort()
  .map((path) => ({
    id: relative(join(root, 'drizzle'), path).replaceAll('\\', '/'),
    statements: readFileSync(path, 'utf8')
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean),
  }));
writeFileSync(
  join(outputDir, 'migrations.js'),
  `export const migrations=${JSON.stringify(migrations)};\n`,
);

writeFileSync(
  join(outputDir, 'index.js'),
  `import application from './application.js';
import {fetchAsset} from './assets.js';
import {migrations} from './migrations.js';
const BASE_PATH=${JSON.stringify(basePath)};
const BUILD=${JSON.stringify(new Date().toISOString())};
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const assets={fetch:fetchAsset};
function applicationRequest(request){
  const url=new URL(request.url);
  if(!url.pathname.startsWith(BASE_PATH))url.pathname=BASE_PATH+(url.pathname==='/'?'':url.pathname);
  return new Request(url,request);
}
function authorized(request,env){
  const supplied=request.headers.get('x-kanby-migration-token');
  return Boolean(env.MIGRATION_TOKEN&&supplied&&supplied===env.MIGRATION_TOKEN);
}
async function migrate(env){
  if(!env.DB)throw new Error('DB binding unavailable');
  await env.DB.exec('CREATE TABLE IF NOT EXISTS __xapi_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)');
  const rows=await env.DB.prepare('SELECT id FROM __xapi_migrations').all();
  const applied=new Set(rows.results.map((row)=>String(row.id)));
  const completed=[];
  for(const migration of migrations){
    if(applied.has(migration.id))continue;
    await env.DB.batch(migration.statements.map((sql)=>env.DB.prepare(sql)));
    await env.DB.prepare('INSERT INTO __xapi_migrations (id,applied_at) VALUES (?,?)').bind(migration.id,Date.now()).run();
    completed.push(migration.id);
  }
  return completed;
}
async function acceptance(env){
  if(!env.DB||!env.ATTACHMENTS)throw new Error('DB or ATTACHMENTS binding unavailable');
  const id=crypto.randomUUID();const key='xapi-acceptance/'+id+'.txt';const body='kanby '+id;
  await env.ATTACHMENTS.put(key,body,{httpMetadata:{contentType:'text/plain; charset=utf-8'}});
  const stored=await env.ATTACHMENTS.get(key);const read=stored?await stored.text():null;
  await env.DB.prepare('INSERT INTO projects (id,name,created_at,updated_at) VALUES (?,?,?,?)').bind(id,'xAPI acceptance',Date.now(),Date.now()).run();
  const row=await env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(id).first();
  await env.DB.prepare('DELETE FROM projects WHERE id=?').bind(id).run();
  await env.ATTACHMENTS.delete(key);
  return {d1:row?.id===id,r2:read===body,cleanup:true};
}
export default {
  async fetch(request,env,context){
    const path=new URL(request.url).pathname;
    if(request.method==='GET'||request.method==='HEAD'){
      const asset=await fetchAsset(request);
      if(asset.status!==404)return asset;
    }
    if(path==='/__xapi/health')return json({ok:true,app:'kanby',build:BUILD,bindings:{DB:Boolean(env.DB),ATTACHMENTS:Boolean(env.ATTACHMENTS)}});
    if(path==='/__xapi/migrate'&&request.method==='POST'){
      if(!authorized(request,env))return json({error:'Unauthorized'},401);
      try{return json({ok:true,applied:await migrate(env)});}catch(error){return json({error:error instanceof Error?error.message:String(error)},500);}
    }
    if(path==='/__xapi/acceptance'&&request.method==='POST'){
      if(!authorized(request,env))return json({error:'Unauthorized'},401);
      try{return json({ok:true,...await acceptance(env)});}catch(error){return json({error:error instanceof Error?error.message:String(error)},500);}
    }
    return application.fetch(applicationRequest(request),{...env,ASSETS:assets},context);
  },
  scheduled(controller,env,context){return application.scheduled?.(controller,{...env,ASSETS:assets},context);}
};
`,
);

const files = walk(outputDir);
const bytes = files.reduce((total, path) => total + statSync(path).size, 0);
console.log(
  JSON.stringify({
    outputDir,
    modules: files.length,
    bytes,
    assets: Object.keys(assets).length,
  }),
);
if (files.length > 200)
  throw new Error(`Too many Worker modules: ${files.length}`);
if (bytes > 10 * 1024 * 1024)
  throw new Error(`Worker artifact exceeds 10 MiB: ${bytes}`);
