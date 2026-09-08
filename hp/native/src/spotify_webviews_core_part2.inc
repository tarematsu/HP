          ComPtr<ICoreWebView2ControllerOptions> options;
          if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
              !options) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }
          const std::wstring profileName =
              std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + 1);
          if (FAILED(options->put_ProfileName(profileName.c_str())) ||
              FAILED(options->put_IsInPrivateModeEnabled(FALSE))) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
            return;
          }

          const auto ready =
              Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                  [this, alive, target](HRESULT controllerResult,
                                        ICoreWebView2Controller* controller)
                      -> HRESULT {
                    if (!alive->load(std::memory_order_acquire)) {
                      if (controller) controller->Close();
                      return S_OK;
                    }
                    target->controllerCreating = false;
                    target->controllerCreateTick = 0;
                    if (FAILED(controllerResult) || !controller ||
                        !target->hostWindow || !IsWindow(target->hostWindow)) {
                      if (controller) controller->Close();
                      MarkSlotRecovering(*target, GetTickCount64());
                      return S_OK;
                    }
                    target->controller = controller;
                    target->controller->get_CoreWebView2(&target->webview);
                    if (!target->webview) {
                      target->controller->Close();
                      target->controller.Reset();
                      MarkSlotRecovering(*target, GetTickCount64());
                      return S_OK;
                    }
                    Configure(*target);
                    return S_OK;
                  });

          const HRESULT createResult =
              environment10->CreateCoreWebView2ControllerWithOptions(
                  target->hostWindow, options.Get(), ready.Get());
          if (FAILED(createResult)) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            MarkSlotRecovering(*target, GetTickCount64());
          }
        });
  } catch (...) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    MarkSlotRecovering(slot, GetTickCount64());
  }
}

void SpotifyWebViews::Configure(Slot& slot) noexcept {
  if (!slot.controller || !slot.webview) return;
  try {
    SetSpotifyOutputMuted(slot.webview);
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(slot.controller.As(&controller2)) && controller2) {
      COREWEBVIEW2_COLOR background{255, 0, 0, 0};
      controller2->put_DefaultBackgroundColor(background);
    }
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(slot.webview->get_Settings(&settings)) && settings) {
      settings->put_IsScriptEnabled(TRUE);
      settings->put_IsWebMessageEnabled(TRUE);
      settings->put_AreDefaultScriptDialogsEnabled(TRUE);
      settings->put_AreDefaultContextMenusEnabled(FALSE);
      settings->put_AreDevToolsEnabled(FALSE);
      settings->put_IsStatusBarEnabled(FALSE);
      settings->put_AreHostObjectsAllowed(FALSE);
      settings->put_IsZoomControlEnabled(FALSE);
      settings->put_IsBuiltInErrorPageEnabled(TRUE);
      ComPtr<ICoreWebView2Settings3> settings3;
      if (SUCCEEDED(settings.As(&settings3)) && settings3) {
        settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
      }
    }

    Slot* const target = &slot;
    const auto alive = alive_;
    slot.webview->AddWebResourceRequestedFilter(
        L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
    slot.webview->AddWebResourceRequestedFilter(
        L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
    slot.webview->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [alive, target](ICoreWebView2*,
                            ICoreWebView2WebResourceRequestedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args ||
                  !target->playerPage || !target->environment) {
                return S_OK;
              }
              ComPtr<ICoreWebView2WebResourceResponse> response;
              if (SUCCEEDED(target->environment->CreateWebResourceResponse(
                      nullptr, 204, L"No Content",
                      L"Cache-Control: no-store\r\n", &response)) && response) {
                args->put_Response(response.Get());
              }
              return S_OK;
            }).Get(),
        &slot.webResourceRequestedToken);

    slot.webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, alive, target](ICoreWebView2*,
