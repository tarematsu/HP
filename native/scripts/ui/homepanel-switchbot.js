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

  function renderEnergyPlugs(value = {}) {
    const container = $('#energy-plugs');
    if (!container) return;

    const devices = Array.isArray(value.devices) ? value.devices : [];
    const plugs = devices.filter(device => /Plug Mini/i.test(String(device.deviceType || '')));
    const signature = JSON.stringify([
      value?.serviceAvailable, value?.__status, value?.degradedReason, value?.__error,
      plugs.map(device => [device.deviceId, device.deviceName, device.watts, device.power, device.error]),
    ]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;

    const available = value?.serviceAvailable !== false &&
      !['stale', 'error', 'waiting'].includes(value?.__status);
    if (!plugs.length) {
      container.innerHTML = `<div class="plug-empty">${available ? 'Plug Mini情報なし' : 'Plug Mini情報を取得できません'}</div>`;
      return;
    }

    container.innerHTML = plugs.map(device => {
      const online = available && !device.error;
      const raw = online ? String(device.power || '').trim().toUpperCase() : '';
      const state = raw === 'ON' ? 'ON' : raw === 'OFF' ? 'OFF' : '--';
      const watts = online && finite(device.watts) ? `${Number(device.watts).toFixed(1)} W` : '-- W';
      const name = device.deviceName || device.deviceId || 'Plug Mini';
      const reason = device.error || value?.degradedReason || value?.__error || '';
      const title = reason ? ` title="${escapeHtml(reason)}"` : '';
      return `<div class="energy-plug${online ? '' : ' is-unavailable'}"${title}><span class="energy-plug-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="energy-plug-watts">${escapeHtml(watts)}</span><b class="energy-plug-state ${state === 'ON' ? 'is-on' : state === 'OFF' ? 'is-off' : 'is-unknown'}">${state}</b></div>`;
    }).join('');
  }

  root.panels = root.panels || {};
  root.panels.switchbot = { renderSwitchBot, renderEnergyPlugs };
})();
