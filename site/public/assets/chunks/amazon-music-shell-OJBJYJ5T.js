import{b as c}from"./chunk-M6MEDLVT.js";import{a as n,b as l,c as a}from"./chunk-JSQGSUSS.js";import{B as s,u as o,y as e,z as i}from"./chunk-2LGKC3RA.js";var m=o({className:"amazon-table regional-music-table music-service-track-table",wrapClassName:"table-fit-mobile",colgroupHtml:'<colgroup><col class="amazon-rank-col"><col class="amazon-rank-col"><col class="amazon-artist-col"><col></colgroup>',headers:["Amazon Music総合順位","前日比","アーティスト","曲名"],bodyId:"amazonMusicTbody"}),r=`
  <div class="mode-tabs amazon-mode-switch regional-chart-filter" role="group" aria-label="Amazon Music表示切替">
    <button type="button" class="is-active" data-amazon-mode="all" aria-pressed="true">全楽曲順位</button>
    <button type="button" data-amazon-mode="titles" aria-pressed="false">表題曲比較</button>
    <button type="button" data-amazon-mode="sakurazaka" aria-pressed="false">櫻坂46</button>
    <button type="button" data-amazon-mode="nogizaka" aria-pressed="false">乃木坂46</button>
    <button type="button" data-amazon-mode="hinatazaka" aria-pressed="false">日向坂46</button>
  </div>`,d=a({id:"amazonTrendSection",title:"Amazon Music総合順位推移",titleId:"amazonAllRankTitle",trailingHtml:r,bodyHtml:'<div id="amazonRankLegend" class="chart-legend" aria-label="楽曲凡例"></div>'+i({id:"amazonAllRankChart",className:"amazon-rank-chart chart-fit",ariaLabel:"坂道3グループ楽曲のAmazon Music総合順位推移",role:""})}),u=a({id:"amazonTrackSection",title:"全楽曲順位",titleId:"amazonTracksTitle",bodyHtml:m}),b=a({id:"amazonPlaylistSection",title:"Amazon Music プレイリスト掲載一覧",bodyHtml:'<div id="amazonPlaylistMount"></div>'});s({tab:{view:"amazon-music",label:"Amazon Music",anchorSelector:'[data-view="spotify"]',position:"afterend"},view:{id:"amazonMusicView",className:n("amazon-music-view"),anchorId:"likesView",position:"beforebegin",html:`
      ${l({valueId:"amazonUpdatedAt",cadence:"毎日朝ごろ"})}
      ${e({id:"amazonMusicNotice"})}
      ${d}
      ${u}
      ${b}`}});c();function z(){return["/music-service-playlists.js","v=20261003.2"].join("?")}import(z()).then(t=>t.loadMusicServicePlaylists?.("amazon")).catch(t=>console.warn("Amazon Music playlist view failed to load",t));
