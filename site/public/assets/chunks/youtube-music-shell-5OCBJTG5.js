import{a as l,b as s}from"./chunk-AG3D5TOJ.js";import{B as u,p as e,q as a,u as i,w as t,y as c}from"./chunk-2LGKC3RA.js";var o=a([e({label:"状態",valueId:"youtubeMusicStatus"}),e({label:"アーティスト",valueId:"youtubeMusicArtistCount"}),e({label:"楽曲",valueId:"youtubeMusicTrackCount"}),e({label:"作品",valueId:"youtubeMusicReleaseCount"})],{className:"music-service-summary",ariaLabel:"YouTube Music概要"}),d=i({className:"music-service-track-table",headers:["アーティスト","登録者","月間視聴者","総視聴回数","サービスID"],bodyId:"youtubeMusicArtistBody"}),r=i({className:"music-service-track-table",headers:["アーティスト","作品","種別","年"],bodyId:"youtubeMusicReleaseBody"}),b=i({className:"music-service-track-table",headers:["アーティスト","曲名","アルバム","videoId"],bodyId:"youtubeMusicTrackBody"}),m=i({className:"music-service-playlist-table",headers:["プレイリスト","種別","対象曲数"],bodyId:"youtubeMusicPlaylistBody"}),y=t({title:"収集状態",kicker:"COLLECTOR",className:"music-service-panel",bodyHtml:'<dl id="youtubeMusicHealth" class="regional-music-health-list"></dl>'});u({view:{id:"youtubeMusicView",className:"youtube-music-view music-service-view",anchorId:"likesView",position:"beforebegin",html:`
      ${l({label:"更新日時",valueId:"youtubeMusicUpdated",cadence:"毎日0:00"})}
      ${c({id:"youtubeMusicNotice"})}
      <div class="regional-music-title-row">
        <div><p class="kicker">YOUTUBE MUSIC</p><h2>YouTube Music</h2></div>
        <span class="regional-music-region">JP / Global</span>
      </div>
      ${o}
      <section id="youtubeMusicHealthSection" class="music-service-section">${y}</section>
      ${s({id:"youtubeMusicArtistSection",kicker:"ARTISTS",title:"アーティスト",bodyHtml:d})}
      ${s({id:"youtubeMusicReleaseSection",kicker:"RELEASES",title:"アルバム・シングル",bodyHtml:r})}
      ${s({id:"youtubeMusicTrackSection",kicker:"TRACKS",title:"楽曲",bodyHtml:b})}
      ${s({id:"youtubeMusicPlaylistSection",kicker:"PLAYLISTS",title:"公開プレイリスト",bodyHtml:m})}`}});
