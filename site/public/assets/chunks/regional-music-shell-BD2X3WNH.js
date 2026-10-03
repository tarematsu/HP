import{a as l,b as t}from"./chunk-AG3D5TOJ.js";import{B as n,p as e,q as o,u as i,w as r,y as c}from"./chunk-2LGKC3RA.js";var u=o([e({label:"状態",valueId:"regionalMusicStatus"}),e({label:"アーティスト",valueId:"regionalMusicArtistCount"}),e({label:"楽曲",valueId:"regionalMusicTrackCount"}),e({label:"プレイリスト",valueId:"regionalMusicPlaylistCount"})],{className:"music-service-summary regional-music-summary",ariaLabel:"地域音楽サービス概要"}),g=i({className:"regional-music-table regional-music-artist-table music-service-track-table",headers:["アーティスト","フォロワー","いいね","サービスID"],bodyId:"regionalMusicArtistBody",wrapClassName:"regional-music-table-wrap"}),m=i({className:"regional-music-table regional-music-track-table music-service-track-table",headers:["アーティスト","曲名","再生数","リスナー","いいね","コメント","順位"],bodyId:"regionalMusicTrackBody",wrapClassName:"regional-music-table-wrap"}),h=i({className:"regional-music-table regional-music-playlist-table music-service-playlist-table",headers:["プレイリスト","種別","所有者","対象曲数"],bodyId:"regionalMusicPlaylistBody",wrapClassName:"regional-music-table-wrap"}),b=i({className:"regional-music-table regional-music-melon-popularity-table music-service-track-table",headers:["グループ","順位","曲名"],bodyId:"melonArtistPopularityBody",wrapClassName:"regional-music-table-wrap"}),v=i({className:"regional-music-table regional-music-kugou-history-table music-service-track-table",headers:["年月日","グループ","順位","曲名"],bodyId:"kugouJapanHistoryBody",wrapClassName:"regional-music-table-wrap"}),y=i({className:"regional-music-table regional-music-kugou-history-table music-service-track-table",headers:["更新日","グループ","順位","曲名"],bodyId:"kugouAcgHistoryBody",wrapClassName:"regional-music-table-wrap"}),p=i({className:"regional-music-table regional-music-kugou-history-table regional-music-qq-history-table music-service-track-table",headers:["更新日","グループ","順位","曲名"],bodyId:"qqJapanHistoryBody",wrapClassName:"regional-music-table-wrap"}),k=i({className:"regional-music-table regional-music-kugou-history-table regional-music-qq-history-table music-service-track-table",headers:["更新日","グループ","順位","曲名"],bodyId:"qqAnimeHistoryBody",wrapClassName:"regional-music-table-wrap"}),q=i({className:"regional-music-table regional-music-qq-popularity-table music-service-track-table",headers:["グループ","順位","曲名"],bodyId:"qqArtistPopularityBody",wrapClassName:"regional-music-table-wrap"}),C=r({title:"収集状態",kicker:"COLLECTOR",className:"regional-music-health music-service-panel",bodyHtml:'<dl id="regionalMusicHealth" class="regional-music-health-list"></dl>'});function s(a,d){return`
    <div class="mode-tabs regional-chart-filter" role="group" aria-label="${d}">
      <button type="button" class="active" data-${a}-artist-filter="all" aria-pressed="true">すべて</button>
      <button type="button" data-${a}-artist-filter="sakurazaka46" aria-pressed="false">櫻坂</button>
      <button type="button" data-${a}-artist-filter="nogizaka46" aria-pressed="false">乃木坂</button>
      <button type="button" data-${a}-artist-filter="hinatazaka46" aria-pressed="false">日向坂</button>
    </div>`}var S=`
  <section id="melonArtistPopularitySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>Melon アーティスト別人気曲順位</h2>
      ${s("melon","Melon 人気曲 表示グループ")}
    </div>
    ${b}
  </section>`,$=`
  <section id="qqJapanChartSection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>QQ音乐 日本榜 グループ別最高順位推移</h2></div>
    <div id="qqJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="qqJapanRankChart" class="regional-music-rank-chart"></div>
  </section>`,A=`
  <section id="qqJapanHistorySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>QQ音乐 日本榜 ランクイン履歴</h2>
      ${s("qq","QQ音乐 日本榜 表示グループ")}
    </div>
    ${p}
  </section>`,M=`
  <section id="qqAnimeChartSection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>QQ音乐 动漫音乐榜 グループ別最高順位推移</h2></div>
    <div id="qqAnimeRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="qqAnimeRankChart" class="regional-music-rank-chart"></div>
  </section>`,N=`
  <section id="qqAnimeHistorySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>QQ音乐 动漫音乐榜 ランクイン履歴</h2>
      ${s("qq","QQ音乐 动漫音乐榜 表示グループ")}
    </div>
    ${k}
  </section>`,w=`
  <section id="qqArtistPopularitySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>QQ音乐 アーティスト別人気曲順位</h2></div>
    ${q}
  </section>`,H=`
  <section id="kugouJapanChartSection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>酷狗音乐 日本榜 グループ別最高順位推移</h2></div>
    <div id="kugouJapanRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="kugouJapanRankChart" class="regional-music-rank-chart"></div>
  </section>`,I=`
  <section id="kugouJapanHistorySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>酷狗音乐 日本榜 ランクイン履歴</h2>
      ${s("kugou","酷狗音乐 日本榜 表示グループ")}
    </div>
    ${v}
  </section>`,T=`
  <section id="kugouAcgChartSection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head"><h2>酷狗音乐 ACG新歌榜 グループ別最高順位推移</h2></div>
    <div id="kugouAcgRankLegend" class="regional-music-rank-legend" aria-label="グループ凡例"></div>
    <div id="kugouAcgRankChart" class="regional-music-rank-chart"></div>
  </section>`,Q=`
  <section id="kugouAcgHistorySection" class="music-service-section regional-chart-section" hidden>
    <div class="regional-chart-section-head">
      <h2>酷狗音乐 ACG新歌榜 ランクイン履歴</h2>
      ${s("kugou","酷狗音乐 ACG新歌榜 表示グループ")}
    </div>
    ${y}
  </section>`;n({view:{id:"regionalMusicView",className:"regional-music-view music-service-view",anchorId:"likesView",position:"beforebegin",html:`
      <div id="regionalMusicGenericHeader">
        ${l({label:"更新",valueId:"regionalMusicUpdated"})}
        ${c({id:"regionalMusicNotice"})}
        <div class="regional-music-title-row">
          <div><p class="kicker">REGIONAL MUSIC</p><h2 id="regionalMusicTitle">-</h2></div>
          <span id="regionalMusicRegion" class="regional-music-region"></span>
        </div>
        ${u}
        <section id="regionalMusicHealthSection" class="music-service-section">${C}</section>
      </div>
      <div id="regionalMusicCompactMeta" class="regional-chart-meta" hidden>
        <span>更新日時 <strong id="regionalMusicChartUpdated">-</strong></span>
        <span>更新周期 <strong id="regionalMusicChartCadence">-</strong></span>
      </div>
      <div id="regionalMusicCompactNotice" hidden>${c({id:"regionalMusicCompactNoticeText"})}</div>
      ${S}
      ${$}
      ${A}
      ${M}
      ${N}
      ${w}
      ${H}
      ${I}
      ${T}
      ${Q}
      <div id="regionalMusicGenericTables">
        ${t({id:"regionalMusicArtistSection",kicker:"ARTISTS",title:"アーティスト",bodyHtml:g})}
        ${t({id:"regionalMusicTrackSection",kicker:"TRACKS",title:"楽曲",bodyHtml:m})}
        ${t({id:"regionalMusicPlaylistSection",kicker:"PLAYLISTS",title:"プレイリスト",bodyHtml:h})}
      </div>`}});import("./qq-japan-chart-ui-22QBQ7FL.js").then(({initQqJapanHistoryUi:a})=>a());import("./netease-japan-chart-ui-QRYSU7LT.js");
