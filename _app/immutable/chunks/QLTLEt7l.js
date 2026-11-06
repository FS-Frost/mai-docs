import{r as e}from"./BCiCTKAo.js";import{b as t}from"./Bq3xeFK9.js";import{n}from"./DiBmOQv2.js";import{r}from"./BA5qfd1P.js";import{n as i}from"./BMbc2L__.js";import{t as a}from"./B6ymMoSJ.js";import{i as o,l as s,r as c}from"./Cj9LTwme.js";import{n as l}from"./CfqhXIep.js";import{n as u,t as d}from"./D5Auqt3U.js";import{n as f}from"./kt5hcrhB.js";var p=e({FORMATS:()=>m,chartImage:()=>_,exportDoc:()=>b,printDoc:()=>x}),m={docx:{ext:`.docx`,mime:`application/vnd.openxmlformats-officedocument.wordprocessingml.document`},md:{ext:`.md`,mime:`text/markdown`},html:{ext:`.html`,mime:`text/html`},txt:{ext:`.txt`,mime:`text/plain`}};async function h(e){let t=[...new Set(e.match(/(?:blob:[^"')\s]+|mai-blob:[\w-]+)/g)??[])];for(let n of t){let t=await s(n);t&&(e=e.split(n).join(await c(t)))}return e}async function g(e){let t=e;return{blob:await n(t.options,t.data,t.width,t.height,r.locale),width:t.width,height:t.height}}var _=async e=>{let{blob:t,width:n,height:r}=await g(e);return{data:new Uint8Array(await t.arrayBuffer()),type:`png`,width:n,height:r}};async function v(e){if(e.type===`chart`){let{blob:t,width:n}=await g(e.attrs??{}),r=e.attrs?.options?.title;return{type:`image`,attrs:{src:await c(t),alt:r??``,width:n}}}return e.content?{...e,content:await Promise.all(e.content.map(v))}:e}var y=e=>e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`);async function b(e,n,r,s){let{mime:c}=m[n];switch(n){case`docx`:{let t=await d(o(e.getJSON()),r,f,s,_);return new Blob([await u(t)],{type:c})}case`md`:{let t=a(await v(e.getJSON()));return new Blob([await h(t)],{type:c})}case`html`:{let n=l(r),a=r.margins,o=await h(t(await v(e.getJSON()),i())),u=`<!doctype html>
<html><head><meta charset="utf-8"><title>${y(s)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@page{size:${n.w}mm ${n.h}mm;margin:${a.top}mm ${a.right}mm ${a.bottom}mm ${a.left}mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.5;color:#1a1a1a;max-width:${n.w-a.left-a.right}mm;margin:2rem auto;padding:0 1rem}
h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #9a9a9a;padding:.3em .5em;vertical-align:top}th{background:#f2f2f2;text-align:left}
td>p,th>p,li>p{margin:0}img{max-width:100%;height:auto}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1em;color:#555}
pre{background:#f5f5f5;padding:.7em .9em;border-radius:4px;white-space:pre-wrap}code{font-family:Consolas,monospace}
ul[data-type=taskList]{list-style:none;padding-left:.2em}ul[data-type=taskList] li{display:flex;gap:.5em}
img[data-align=center]{display:block;margin:0 auto}img[data-align=right]{display:block;margin-left:auto}
img[data-wrap=left]{float:left;margin:.2em 1em .5em 0}img[data-wrap=right]{float:right;margin:.2em 0 .5em 1em}
p.caption{font-size:.85em;font-style:italic;color:#555}h1,h2,h3,table{clear:both}
</style></head><body>
${o}
</body></html>`;return new Blob([u],{type:c})}case`txt`:return new Blob([e.getText({blockSeparator:`

`})],{type:`${c};charset=utf-8`})}}function x(e){let t=l(e),n=e.margins,r=document.getElementById(`mai-print-page`);r||(r=document.createElement(`style`),r.id=`mai-print-page`,document.head.append(r)),r.textContent=`@page { size: ${t.w}mm ${t.h}mm; margin: ${n.top}mm ${n.right}mm ${n.bottom}mm ${n.left}mm; }`,window.print()}export{x as i,b as n,p as r,m as t};