import './followers-shell.js?v=20260930.3';
import { registerStandaloneDashboardRoute } from './dashboard-standalone-route.js?v=20260930.1';

registerStandaloneDashboardRoute({
  mode: 'followers',
  viewId: 'followersView',
  noticeId: 'followersNotice',
  runtimeUrl: '/followers.js?v=20260930.3',
  loadExport: 'loadFollowersView',
  errorLabel: 'followers',
  errorMessage: 'フォロワーデータの初期化に失敗しました。再読み込みしてください。',
});
