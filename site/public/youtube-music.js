import { setNotice } from './dashboard-ui-common.js?v=20261001.1';

export async function loadYoutubeMusicView() {
  setNotice('youtubeMusicNotice', 'YouTube Musicはタブのみ先行追加しています。専用収集/read model接続後にデータ表示へ切り替えます。');
}
