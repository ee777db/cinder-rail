import {build} from 'esbuild';
import fs from 'node:fs/promises';
for(const [entry,outfile] of [['browser/native-app.ts','public/native-app.js'],['sdk/native-client.ts','public/native-sdk.js'],['browser/explorer.ts','public/explorer.js']]){
 if(await fs.access(entry).then(()=>true,()=>false)){const result=await build({entryPoints:[entry],outfile,bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,metafile:true});console.log(`${outfile}: ${result.metafile.outputs[outfile]?.bytes??'built'} bytes`);}
}
