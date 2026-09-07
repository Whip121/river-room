import {readFile,writeFile} from 'node:fs/promises';
const read=file=>readFile(new URL(file,import.meta.url),'utf8');
const [html,css,engine,app]=await Promise.all([read('./public/index.html'),read('./public/style.css'),read('./public/engine.mjs'),read('./public/app.mjs')]);
const code='globalThis.RIVER_STANDALONE=true;\n'+engine.replace(/^export /gm,'')+'\n'+app.replace(/^import .*?;\s*/,'');
const output=html.replace('<link rel="icon" href="/favicon.svg">','').replace('<link rel="stylesheet" href="/style.css">','<style>'+css+'</style>').replace('<script type="module" src="/app.mjs"></script>','<script type="module">'+code.replace(/<\/script/gi,'<\\/script')+'</script>');
await writeFile(new URL('./河畔牌室-本机试玩.html',import.meta.url),output,'utf8');
console.log('Standalone poker page built.');
