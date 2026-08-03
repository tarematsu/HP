#include "app.h"
#include "power_saving_controller.h"

namespace {

constexpr ULONGLONG kCrashRestartStabilityMs = 60'000;
const ULONGLONG gProcessStartedAt = GetTickCount64();

bool HasCommandArgument(const wchar_t* expected) noexcept {
  int argc = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) return false;
  bool found = false;
  for (int index = 1; index < argc; ++index) {
    if (_wcsicmp(argv[index], expected) == 0) {
      found = true;
      break;
    }
  }
  LocalFree(argv);
  return found;
}

bool RelaunchSelf(bool crashRestart = false) {
  wchar_t executable[MAX_PATH * 4]{};
  if (!GetModuleFileNameW(nullptr, executable, _countof(executable))) return false;

  std::wstring command = L"\"" + std::wstring(executable) + L"\"";
  if (crashRestart) command += L" --crash-restart";
  std::vector<wchar_t> commandBuffer(command.begin(), command.end());
  commandBuffer.push_back(L'\0');
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  const BOOL created = CreateProcessW(
      executable,
      commandBuffer.data(),
      nullptr,
      nullptr,
      FALSE,
      0,
      nullptr,
      nullptr,
      &startup,
      &process);
  if (!created) return false;
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

void RelaunchAfterCrashOnce() noexcept {
  const bool isRecoveryProcess = HasCommandArgument(L"--crash-restart");
  const ULONGLONG uptime = GetTickCount64() - gProcessStartedAt;
  if (isRecoveryProcess && uptime < kCrashRestartStabilityMs) return;
  try {
    RelaunchSelf(true);
  } catch (...) {
  }
}

LONG WINAPI UnhandledFilter(EXCEPTION_POINTERS* pointers) {
  try {
    if (auto app = hp::App::Current()) {
      app->LogUnhandled(
          pointers && pointers->ExceptionRecord
              ? pointers->ExceptionRecord->ExceptionCode
              : 0,
          pointers && pointers->ExceptionRecord
              ? pointers->ExceptionRecord->ExceptionAddress
              : nullptr);
    }
  } catch (...) {
  }
  RelaunchAfterCrashOnce();
  return EXCEPTION_EXECUTE_HANDLER;
}

[[noreturn]] void TerminateHandler() noexcept {
  try {
    if (auto app = hp::App::Current()) {
      app->LogUnhandled(0xe0000001u, nullptr);
    }
  } catch (...) {
  }
  RelaunchAfterCrashOnce();
  TerminateProcess(GetCurrentProcess(), 3);
  ExitProcess(3);
}

void ShowStartupFailure(const std::wstring& message) {
  MessageBoxW(
      nullptr, message.c_str(), L"HomePanel startup failed",
      MB_ICONERROR | MB_OK | MB_TOPMOST | MB_SETFOREGROUND);
}

}  // namespace

int WINAPI wWinMain(
    _In_ HINSTANCE instance,
    _In_opt_ HINSTANCE,
    _In_ LPWSTR,
    _In_ int showCommand) {
  SetUnhandledExceptionFilter(UnhandledFilter);
  std::set_terminate(TerminateHandler);

  bool apartmentInitialized = false;
  int result = 1;
  try {
    if (HasCommandArgument(L"--crash-restart")) {
      // The crashed process may still own the single-instance mutex briefly.
      Sleep(1'500);
    }
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    apartmentInitialized = true;
    hp::PowerSavingController powerSavingController;
    powerSavingController.InstallForCurrentThread();
    {
      hp::App app(instance);
      result = app.Run(showCommand);
    }
    powerSavingController.Uninstall();
    if (result == 42) result = RelaunchSelf() ? 0 : 1;
  } catch (const std::exception& error) {
    ShowStartupFailure(hp::Utf8ToWide(error.what()));
  } catch (...) {
    ShowStartupFailure(L"不明な例外によりHomePanelを起動できませんでした。");
  }
  if (apartmentInitialized) winrt::uninit_apartment();
  return result;
}
