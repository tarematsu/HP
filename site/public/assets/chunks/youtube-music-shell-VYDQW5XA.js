import{a as u,b as c,c as i}from"./chunk-JSQGSUSS.js";import{B as t,u as e,y as s}from"./chunk-2LGKC3RA.js";var a=e({className:"regional-music-table music-service-track-table",headers:["アーティスト","登録者","月間視聴者","総視聴回数","サービスID"],bodyId:"youtubeMusicArtistBody"}),o=e({className:"regional-music-table music-service-track-table",headers:["アーティスト","作品","種別","年"],bodyId:"youtubeMusicReleaseBody"}),l=e({className:"regional-music-table music-service-track-table",headers:["アーティスト","曲名","アルバム","videoId"],bodyId:"youtubeMusicTrackBody"}),b=e({className:"regional-music-table music-service-playlist-table",headers:["プレイリスト","種別","対象曲数"],bodyId:"youtubeMusicPlaylistBody"});t({view:{id:"youtubeMusicView",className:u("youtube-music-view"),anchorId:"likesView",position:"beforebegin",html:`
      ${c({valueId:"youtubeMusicUpdated",cadence:"毎日0:00"})}
      ${s({id:"youtubeMusicNotice"})}
      ${i({id:"youtubeMusicArtistSection",title:"YouTube Music アーティスト",bodyHtml:a})}
      ${i({id:"youtubeMusicReleaseSection",title:"YouTube Music アルバム・シングル",bodyHtml:o})}
      ${i({id:"youtubeMusicTrackSection",title:"YouTube Music 楽曲",bodyHtml:l})}
      ${i({id:"youtubeMusicPlaylistSection",title:"YouTube Music 公開プレイリスト",bodyHtml:b})}`}});
