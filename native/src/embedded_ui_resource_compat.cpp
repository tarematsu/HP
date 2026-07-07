namespace {
inline HGLOBAL LoadResource(HRSRC resource) {
  return ::LoadResource(GetModuleHandleW(nullptr), resource);
}
}  // namespace
