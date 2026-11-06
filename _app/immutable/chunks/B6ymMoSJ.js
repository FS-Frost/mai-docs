import{n as e,u as t}from"./BMbc2L__.js";var n,r=()=>n??=new t({extensions:e()});function i(e){let t=r().parse(e.replace(/\r\n?/g,`
`));return t.content?.length?t:{type:`doc`,content:[{type:`paragraph`}]}}function a(e){return r().serialize(e)}function o(e){return{type:`doc`,content:e.replace(/\r\n?/g,`
`).split(/\n{2,}/).map(e=>{let t=e.split(`
`),n=[];return t.forEach((e,t)=>{t&&n.push({type:`hardBreak`}),e&&n.push({type:`text`,text:e})}),n.length?{type:`paragraph`,content:n}:{type:`paragraph`}})}}export{i as n,o as r,a as t};