function l(e,{quoteAll:c=!0}={}){let t=String(e??""),n=t.replaceAll('"','""');return c||/[",\r\n]/.test(t)?`"${n}"`:n}function i(e=[],{bom:c=!0,quoteAll:t=!0,trailingNewline:n=!1}={}){let r=(Array.isArray(e)?e:[]).map(s=>(Array.isArray(s)?s:[s]).map(a=>l(a,{quoteAll:t})).join(",")).join(`
`);return`${c?"\uFEFF":""}${r}${n&&r?`
`:""}`}function u(e,c,t={}){let n=new Blob([i(c,t)],{type:"text/csv;charset=utf-8"}),o=URL.createObjectURL(n),r=document.createElement("a");r.href=o,r.download=String(e||"download.csv"),r.click(),setTimeout(()=>URL.revokeObjectURL(o),0)}export{u as a};
