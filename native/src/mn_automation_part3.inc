  std::wstring BuildProbeScript() const {
    const bool targetSaving = scheduledMorning_;
    const bool needData = !dataSatisfied_;
    const bool needYuzu = config_.yuzuEnabled && !yuzuSatisfied_;
    std::wostringstream script;
    script << LR"JS((() => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const visible = element => {
        if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
        const rect = element.getBoundingClientRect?.();
        if (!rect || rect.width <= 2 || rect.height <= 2) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      };
      const labelOf = element => normalize([
        element?.innerText,
        element?.getAttribute?.('aria-label'),
        element?.textContent,
        element?.getAttribute?.('title'),
        element?.getAttribute?.('value')
      ].filter(Boolean).join(' '));
      if (!document.body || document.readyState === 'loading') return 'page-not-ready';
      const controls = Array.from(document.querySelectorAll(
        "button,[role='button'],[role='switch'],input[type='checkbox'],input[type='submit'],label,a"
      )).filter(visible);
      const mineoSwitchSubmit = document.querySelector('#MineoSwitchSubmit');
      const mineoId = )JS" << JsString(credentials_.id) << LR"JS(;
      const mineoPassword = )JS" << JsString(credentials_.password) << LR"JS(;
      const configuredDataSelector = )JS" << JsString(config_.dataSelector) << LR"JS(;
      const configuredYuzuSelector = )JS" << JsString(config_.yuzuSelector) << LR"JS(;
      const yuzuReadyText = )JS" << JsString(config_.yuzuReadyText) << LR"JS(;
      const yuzuDeclaredText = )JS" << JsString(config_.yuzuDeclaredText) << LR"JS(;
      const targetSaving = )JS" << (targetSaving ? L"true" : L"false") << LR"JS(;
      const needData = )JS" << (needData ? L"true" : L"false") << LR"JS(;
      const needYuzu = )JS" << (needYuzu ? L"true" : L"false") << LR"JS(;

      const setValue = (element, value) => {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, value); else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const clickSubmit = input => {
        const root = input.closest?.('form') || document;
        const candidates = Array.from(root.querySelectorAll("button,input[type='submit'],[role='button'],a")).filter(visible);
        const target = candidates.find(element => /次へ|続ける|ログイン|login|sign\s*in|送信|確認/i.test(labelOf(element))) ||
          candidates.find(element => element.matches?.("button[type='submit'],input[type='submit']"));
        target?.scrollIntoView?.({ block: 'center', inline: 'center' });
        target?.focus?.({ preventScroll: true });
        target?.click?.();
        return Boolean(target);
      };

      const passwordInput = Array.from(document.querySelectorAll('input[type=password]')).find(visible);
      if (passwordInput) {
        if (!mineoPassword) return 'login-password-required';
        setValue(passwordInput, mineoPassword);
        return clickSubmit(passwordInput) ? 'login-password-clicked' : 'login-password-submit-missing';
      }

      const bodyText = normalize(document.body.innerText);
      const loginContext = /eoID|ログイン|login|auth|signin/i.test(bodyText + ' ' + location.href);
      const idInput = Array.from(document.querySelectorAll('input')).find(element => {
        if (!visible(element)) return false;
        const type = String(element.type || 'text').toLowerCase();
        if (!['text', 'email', 'tel'].includes(type)) return false;
        const hint = normalize([element.id, element.name, element.autocomplete, element.placeholder,
          element.getAttribute('aria-label')].filter(Boolean).join(' '));
        return /eo.?id|login|user|account|mail|email|id/i.test(hint);
      });
      if (idInput && loginContext) {
        if (!mineoId) return 'login-id-required';
        setValue(idInput, mineoId);
        return clickSubmit(idInput) ? 'login-id-clicked' : 'login-id-submit-missing';
      }
      if (/eoID|ログイン|パスキー/.test(bodyText) && /login|auth|signin/i.test(location.href)) return 'login-required';

      const contextText = element => normalize([
        labelOf(element),
        labelOf(element.closest?.('section,article,li,div,form') || null)
      ].filter(Boolean).join(' '));
      const savingState = element => {
        const switchRoot = element?.closest?.('ul.mineo_switch_btn');
        if (switchRoot?.classList.contains('on')) return true;
        if (switchRoot?.classList.contains('off')) return false;
        const text = contextText(element);
        if (/節約\s*ON/i.test(text)) return true;
        if (/節約\s*OFF/i.test(text)) return false;
        if (/データ通信\s*ON/i.test(text)) return false;
        if (/データ通信\s*OFF/i.test(text)) return true;
        const aria = element.getAttribute?.('aria-checked');
        const checked = aria === 'true' ? true : aria === 'false' ? false :
          typeof element.checked === 'boolean' ? element.checked : null;
        if (checked === null) return null;
        if (/データ通信/.test(text)) return !checked;
        if (/mineoスイッチ|データ容量節約|節約/.test(text)) return checked;
        return null;
      };
      const clickTarget = element => {
        const target = element?.matches?.("button,[role='button'],[role='switch'],input,a")
          ? element : element?.querySelector?.("button,[role='button'],[role='switch'],input,a") || element;
        target?.scrollIntoView?.({ block: 'center', inline: 'center' });
        target?.focus?.({ preventScroll: true });
        target?.click?.();
      };

      if (needData) {
        let candidates = controls;
        if (configuredDataSelector) {
          const configured = document.querySelector(configuredDataSelector);
          if (configured) candidates = [configured, ...candidates];
        }
        if (mineoSwitchSubmit && visible(mineoSwitchSubmit)) {
          candidates = [mineoSwitchSubmit, ...candidates];
        }
        const dataControl = candidates.find(element => {
          const state = savingState(element);
          if (state === null) return false;
          if (element.id === 'MineoSwitchSubmit') return true;
          const text = contextText(element);
          return /mineoスイッチ|データ容量節約|データ通信|節約\s*(?:ON|OFF)/i.test(text);
        });
        if (!dataControl) return 'data-unknown';
        const currentSaving = savingState(dataControl);
        if (currentSaving === targetSaving) return 'data-satisfied';
        clickTarget(dataControl);
        return 'data-clicked';
      }

      if (needYuzu) {
        if (yuzuDeclaredText && bodyText.includes(yuzuDeclaredText)) return 'yuzu-satisfied';
        let candidates = controls;
        if (configuredYuzuSelector) {
          const configured = document.querySelector(configuredYuzuSelector);
          if (configured) candidates = [configured, ...candidates];
        }
        const yuzuControl = candidates.find(element => {
          const text = contextText(element);
          if (yuzuReadyText && text.includes(yuzuReadyText)) return true;
          return /ゆずるね/.test(text) && /宣言/.test(text) || /^宣言する$/.test(labelOf(element));
        });
        if (!yuzuControl) return 'yuzu-unknown';
        clickTarget(yuzuControl);
        return 'yuzu-clicked';
      }
      return 'complete';
    })())JS";
    return script.str();
  }
