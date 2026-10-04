import{q as l,r as a,s as o,u as e,w as s,z as r}from"./chunk-UYTSKFUP.js";var t=o({className:"followers-table",wrapClassName:"table-fit-mobile",colgroupHtml:'<colgroup><col class="followers-account-col"><col class="followers-affiliation-col"><col><col><col></colgroup>',headId:"followersThead",bodyId:"followersTbody",numeric:!1}),d=`
  <div id="followersCompactMeta" class="regional-chart-meta">
    <span>更新日時 <strong id="followersUpdatedAt">-</strong></span>
    <span>更新周期 <strong id="followersCadence">-</strong></span>
  </div>`;r({view:{id:"followersView",className:"followers-view",anchorId:"historyView",position:"afterend",html:`
      ${d}
      ${s({id:"followersNotice"})}
      ${a({id:"followersChartPanel",title:"",titleId:"followersChartTitle",kicker:"FOLLOW",trailingHtml:l({id:"followersLegend",className:"chart-legend followers-legend",ariaLabel:"フォロワー数の最新値"}),chartHtml:'<div class="chart-fit"><canvas id="followersChart" width="960" height="360" aria-label="フォロワー数推移"></canvas><p id="followersChartEmpty" class="shared-empty" hidden>推移データはありません。</p></div>',detailHtml:'<div id="followersChartDetail" class="chart-detail"></div>',className:"chart-card"})}
      ${e({title:"",titleId:"followersTableTitle",kicker:"LATEST",bodyHtml:t})}`}});
