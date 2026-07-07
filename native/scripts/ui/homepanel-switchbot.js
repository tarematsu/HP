(() => {
  'use strict';

  const root = window.HomePanel;
  const { $, text, finite, number, escapeHtml, icon, T, statusLabel } = root.utils;

  function switchState(device) {
    const type = String(device.deviceType || '');
    if (/Contact/i.test(type)) return device.openState || '-';
    if (/Motion|Presence/i.test(type)) {
      if (device.motion === true) return T('switchbot.motionState.on');
      if (device.motion === false) return T('switchbot.motionState.off');
      return T('switchbot.motionState.unknown');
    }
    if (/Plug/i.test(type)) {
      const watts = finite(device.watts) ? ` ${number(device.watts, 1)}W` : '';
      return `${String(device.power || '-').toUpperCase()}${watts}`;
    }
    return device.battery != null ? `${Math.round(device.battery)}%` : T('switchbot.motionState.unknown');
  }

  function deviceStateClass(device) {
    const type = String(device.deviceType || '');
    if (/Contact/i.test(type)) return device.openState === 'open' ? 'state-alert' : 'state-ok';
    if (/Motion|Presence/i.test(type)) return device.motion ? 'state-warn' : 'state-muted';
    if (/Plug/i.test(type)) return String(device.power || '').toUpperCase() === 'ON' ? 'state-ok' : 'state-muted';
    return device.battery != null && Number(device.battery) < 20 ? 'state-alert' : 'state-muted';
  }

  function summaryIcon(label) {
    if (label.includes('在宅') || label.includes('外出')) return 'i-monitor';
    if (label.includes('明る')) return 'i-bolt';
    if (label.includes('ドア')) return 'i-shield';
    return 'i-bot';
  }

  function summaryClass(key, value) {
    if (key === 'presence') return value.presence === 'home' ? 'chip-ok' : 'chip-muted';
    if (key === 'brightness') return value.brightness === 'bright' ? 'chip-warn' : 'chip-muted';
    if (key === 'door') return value.doorOpen ? 'chip-alert' : 'chip-ok';
    if (key === 'motion') return value.motion ? 'chip-warn' : 'chip-muted';
    return '';
  }

  function deviceIcon(device) {
    const type = String(device.deviceType || '');
    if (/Plug/i.test(type)) return 'i-bolt';
    if (/Contact/i.test(type)) return 'i-shield';
    if (/Motion|Presence/i.test(type)) return 'i-radar';
    return 'i-bot';
  }

  function renderSwitchBot(value = {}) {
    const summary = $('#switchbot-summary');
    const devicesNode = $('#switchbot-devices');
    text('#switchbot-status', statusLabel(value));
    if (!summary || !devicesNode) return;

    const summaryItems = [
      { key: 'presence', label: value.presence === 'home' ? T('switchbot.presence.home') : value.presence === 'away' ? T('switchbot.presence.away') : T('switchbot.presence.unknown') },
      { key: 'brightness', label: value.brightness === 'bright' ? T('switchbot.brightness.bright') : value.brightness === 'dim' ? T('switchbot.brightness.dim') : T('switchbot.brightness.unknown') },
      { key: 'door', label: value.doorOpen ? T('switchbot.door.open') : T('switchbot.door.closed') },
      { key: 'motion', label: value.motion ? T('switchbot.motion.on') : T('switchbot.motion.off') },
    ];
    summary.innerHTML = summaryItems.map(({ key, label }) =>
      `<span class="summary-chip ${summaryClass(key, value)}">${icon(summaryIcon(label))}<span>${escapeHtml(label)}</span></span>`
    ).join('');

    const devices = Array.isArray(value.devices) ? value.devices.slice(0, 6) : [];
    devicesNode.innerHTML = devices.length
      ? devices.map(device => `
        <div class="device">
          <span class="device-main">${icon(deviceIcon(device))}<span class="device-name">${escapeHtml(device.deviceName || device.deviceId || 'SwitchBot')}</span></span>
          <b class="device-state ${deviceStateClass(device)}">${escapeHtml(switchState(device))}</b>
        </div>
      `).join('')
      : `<div class="empty">${escapeHtml(T('empty.switchbot'))}</div>`;
  }

  root.panels = root.panels || {};
  root.panels.switchbot = { renderSwitchBot };
})();
