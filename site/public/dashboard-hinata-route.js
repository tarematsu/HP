import './hinata-shell.js?v=20260930.6';
import { registerStandaloneDashboardRoute } from './dashboard-standalone-route.js?v=20260930.1';

registerStandaloneDashboardRoute({
  mode: 'hinata',
  viewId: 'hinataView',
  noticeId: 'hinataNotice',
  runtimeUrl: '/hinata.js?v=20260930.5',
  loadExport: 'loadHinataView',
  errorLabel: 'hinata',
  errorMessage: '日向坂データの初期化に失敗しました。再読み込みしてください。',
});
