// Brightness override lifecycle only.
struct PowerSavingController::BrightnessState {
  winrt::Windows::Graphics::Display::BrightnessOverride controller{nullptr};
  bool active = false;
};

PowerSavingController::PowerSavingController() = default;
PowerSavingController::~PowerSavingController() { Uninstall(); }

void PowerSavingController::ApplyMinimumBrightness() noexcept {
  try {
    if (!brightnessState_) brightnessState_ = std::make_unique<BrightnessState>();
    if (brightnessState_->active) return;
    if (!brightnessState_->controller) {
      brightnessState_->controller =
          winrt::Windows::Graphics::Display::BrightnessOverride::GetDefaultForSystem();
    }
    if (!brightnessState_->controller) return;
    brightnessState_->controller.SetBrightnessLevel(
        0.0,
        winrt::Windows::Graphics::Display::DisplayBrightnessOverrideOptions::None);
    brightnessState_->controller.StartOverride();
    brightnessState_->active = true;
  } catch (...) {
    try {
      if (brightnessState_ && brightnessState_->controller) {
        brightnessState_->controller.StopOverride();
      }
    } catch (...) {
    }
    brightnessState_.reset();
  }
}

void PowerSavingController::RestoreBrightness() noexcept {
  auto state = std::move(brightnessState_);
  if (!state || !state->active || !state->controller) return;
  try {
    state->controller.StopOverride();
  } catch (...) {
  }
}

void PowerSavingController::RefreshMinimumBrightness() noexcept {
  if (!powerSaving_) return;
  RestoreBrightness();
  ApplyMinimumBrightness();
}
