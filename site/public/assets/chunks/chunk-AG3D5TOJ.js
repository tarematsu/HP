function t({label:s="集計日",valueId:i,cadence:e=""}={}){return e?`<div class="regional-chart-meta music-service-meta">
    <span>${s} <strong${i?` id="${i}"`:""}>-</strong></span>
    <span>更新周期 <strong>${e}</strong></span>
  </div>`:`<div class="music-service-meta">${s} <time${i?` id="${i}"`:""}>-</time></div>`}function n({id:s="",kicker:i="",title:e="",bodyHtml:c=""}={}){return`<section${s?` id="${s}"`:""} class="music-service-section">
    <div class="section-head music-service-section-heading"><div>${i?`<p class="kicker">${i}</p>`:""}<h2>${e}</h2></div></div>
    ${c}
  </section>`}export{t as a,n as b};
