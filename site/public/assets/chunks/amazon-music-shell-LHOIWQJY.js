import{b as d}from"./chunk-M6MEDLVT.js";import{a as r,b as t}from"./chunk-AG3D5TOJ.js";import{B as c,p as a,q as o,t as i,u as l,w as s,y as n,z as m}from"./chunk-2LGKC3RA.js";var u=o([a({label:"対象グループ",value:"3組"}),a({label:"ランクイン曲数",valueId:"amazonTrackCount"}),a({label:"掲載プレイリスト",valueId:"amazonPlaylistCount"})],{className:"music-service-summary amazon-summary-cards",ariaLabel:"Amazon Music概要"}),b=l({className:"amazon-table music-service-track-table",wrapClassName:"table-fit-mobile",colgroupHtml:'<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col class="amazon-artist-col"><col></colgroup>',headers:["Amazon Music総合順位","前日比","アーティスト","曲名"],bodyId:"amazonMusicTbody"}),z=`
  <div class="mode-tabs amazon-mode-switch" role="group" aria-label="Amazon Music表示切替">
    <button type="button" class="is-active" data-amazon-mode="all" aria-pressed="true">全楽曲順位</button>
    <button type="button" data-amazon-mode="titles" aria-pressed="false">表題曲比較</button>
    <button type="button" data-amazon-mode="sakurazaka" aria-pressed="false">櫻坂46</button>
    <button type="button" data-amazon-mode="nogizaka" aria-pressed="false">乃木坂46</button>
    <button type="button" data-amazon-mode="hinatazaka" aria-pressed="false">日向坂46</button>
  </div>`,p=i({title:"Amazon Music総合順位推移",titleId:"amazonAllRankTitle",kicker:"AMAZON MUSIC",className:"amazon-rank-panel music-service-panel",trailingHtml:z,chartHtml:'<div id="amazonRankLegend" class="chart-legend" aria-label="楽曲凡例"></div>'+m({id:"amazonAllRankChart",className:"amazon-rank-chart chart-fit",ariaLabel:"坂道3グループ楽曲のAmazon Music総合順位推移",role:""})}),k=s({title:"全楽曲順位",titleId:"amazonTracksTitle",kicker:"TRACKS",className:"amazon-data-panel music-service-panel",bodyHtml:b});c({tab:{view:"amazon-music",label:"Amazon Music",anchorSelector:'[data-view="spotify"]',position:"afterend"},view:{id:"amazonMusicView",className:"amazon-music-view music-service-view",anchorId:"likesView",position:"beforebegin",html:`
      ${r({label:"更新日時",valueId:"amazonUpdatedAt",cadence:"毎日朝ごろ"})}
      ${n({id:"amazonMusicNotice"})}
      ${u}
      ${t({id:"amazonTrendSection",kicker:"TRENDS",title:"推移",bodyHtml:p})}
      ${t({id:"amazonTrackSection",kicker:"TRACKS",title:"楽曲",bodyHtml:k})}
      ${t({id:"amazonPlaylistSection",kicker:"PLAYLISTS",title:"プレイリスト",bodyHtml:'<div id="amazonPlaylistMount"></div>'})}`}});d();function v(){return["/music-service-playlists.js","v=20261001.1"].join("?")}import(v()).then(e=>e.loadMusicServicePlaylists?.("amazon")).catch(e=>console.warn("Amazon Music playlist view failed to load",e));
