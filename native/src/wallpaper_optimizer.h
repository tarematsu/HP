#pragma once
#include "common.h"
#include <wincodec.h>

namespace hp {
inline fs::path PrepareDashboardWallpaper(const fs::path& source, const fs::path& folder) {
  if (source.empty()) return {};
  std::error_code error;
  if (!fs::is_regular_file(source, error)) return {};

  const int screenWidth = std::max(1, GetSystemMetrics(SM_CXSCREEN));
  const int screenHeight = std::max(1, GetSystemMetrics(SM_CYSCREEN));
  const fs::path destination = folder / L"wallpaper-homepanel.png";
  const fs::path signaturePath = folder / L"wallpaper-homepanel.signature";
  const fs::path temporary = folder / L"wallpaper-homepanel.tmp";

  std::wostringstream signature;
  signature << source.wstring() << L'|' << fs::file_size(source, error) << L'|'
            << fs::last_write_time(source, error).time_since_epoch().count() << L'|'
            << screenWidth << L'x' << screenHeight;
  const std::wstring expectedSignature = signature.str();

  {
    std::wifstream input(signaturePath);
    std::wstring existing;
    std::getline(input, existing);
    error.clear();
    if (existing == expectedSignature && fs::is_regular_file(destination, error) &&
        fs::file_size(destination, error) > 0) {
      return destination;
    }
  }

  const HRESULT comResult = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  const bool uninitialize = SUCCEEDED(comResult);
  if (FAILED(comResult) && comResult != RPC_E_CHANGED_MODE) return {};

  bool success = false;
  do {
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&factory)))) break;

    ComPtr<IWICBitmapDecoder> decoder;
    if (FAILED(factory->CreateDecoderFromFilename(source.c_str(), nullptr, GENERIC_READ,
                                                   WICDecodeMetadataCacheOnLoad, &decoder))) break;
    ComPtr<IWICBitmapFrameDecode> frame;
    if (FAILED(decoder->GetFrame(0, &frame))) break;

    UINT sourceWidth = 0;
    UINT sourceHeight = 0;
    if (FAILED(frame->GetSize(&sourceWidth, &sourceHeight)) || !sourceWidth || !sourceHeight) break;

    const double coverScale = std::max(
        static_cast<double>(screenWidth) / sourceWidth,
        static_cast<double>(screenHeight) / sourceHeight);
    const double scale = std::min(1.0, coverScale);
    const UINT targetWidth = std::max<UINT>(1, static_cast<UINT>(std::lround(sourceWidth * scale)));
    const UINT targetHeight = std::max<UINT>(1, static_cast<UINT>(std::lround(sourceHeight * scale)));

    ComPtr<IWICBitmapScaler> scaler;
    IWICBitmapSource* bitmapSource = frame.Get();
    if (targetWidth != sourceWidth || targetHeight != sourceHeight) {
      if (FAILED(factory->CreateBitmapScaler(&scaler)) ||
          FAILED(scaler->Initialize(frame.Get(), targetWidth, targetHeight,
                                    WICBitmapInterpolationModeFant))) break;
      bitmapSource = scaler.Get();
    }

    ComPtr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(&converter)) ||
        FAILED(converter->Initialize(bitmapSource, GUID_WICPixelFormat32bppBGRA,
                                     WICBitmapDitherTypeNone, nullptr, 0,
                                     WICBitmapPaletteTypeCustom))) break;

    DeleteFileW(temporary.c_str());
    ComPtr<IWICStream> stream;
    if (FAILED(factory->CreateStream(&stream)) ||
        FAILED(stream->InitializeFromFilename(temporary.c_str(), GENERIC_WRITE))) break;

    ComPtr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder)) ||
        FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) break;

    ComPtr<IWICBitmapFrameEncode> outputFrame;
    ComPtr<IPropertyBag2> options;
    if (FAILED(encoder->CreateNewFrame(&outputFrame, &options)) ||
        FAILED(outputFrame->Initialize(options.Get())) ||
        FAILED(outputFrame->SetSize(targetWidth, targetHeight))) break;

    WICPixelFormatGUID pixelFormat = GUID_WICPixelFormat32bppBGRA;
    if (FAILED(outputFrame->SetPixelFormat(&pixelFormat)) ||
        FAILED(outputFrame->WriteSource(converter.Get(), nullptr)) ||
        FAILED(outputFrame->Commit()) || FAILED(encoder->Commit())) break;

    if (!MoveFileExW(temporary.c_str(), destination.c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) break;
    std::wofstream signatureOutput(signaturePath, std::ios::trunc);
    signatureOutput << expectedSignature;
    signatureOutput.flush();
    success = static_cast<bool>(signatureOutput);
  } while (false);

  DeleteFileW(temporary.c_str());
  if (uninitialize) CoUninitialize();
  return success ? destination : fs::path{};
}
}  // namespace hp
