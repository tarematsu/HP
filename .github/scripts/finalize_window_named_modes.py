from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new, label):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    write(path, text.replace(old, new, 1))


# The named labels are materially longer than ST/S1..S5. Fit the font to the
# actual button width so yuukiar/hinata are not clipped on narrow layouts.
p = 'hp/native/src/power_saving_overlay.inc'
s = read(p)
old = '''    const int fontHeight = std::clamp(
        static_cast<int>((button.bottom - button.top) * 42 / 100), 11, 17);
    HFONT font = CreateFontW(
        -fontHeight, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    HGDIOBJ previousFont = SelectObject(paintDc, font);
    SetBkMode(paintDc, TRANSPARENT);
    SetTextColor(paintDc, RGB(232, 237, 244));
    RECT textRect = button;
    DrawTextW(
        paintDc, text, -1, &textRect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    SelectObject(paintDc, previousFont);
    DeleteObject(font);'''
new = '''    int fontHeight = std::clamp(
        static_cast<int>((button.bottom - button.top) * 42 / 100), 11, 17);
    auto createButtonFont = [](int height) {
      return CreateFontW(
          -height, 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE,
          DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
          CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Yu Gothic UI");
    };
    HFONT font = createButtonFont(fontHeight);
    HGDIOBJ previousFont = SelectObject(paintDc, font);
    SIZE textSize{};
    const int availableTextWidth =
        std::max(1L, button.right - button.left - 8);
    if (GetTextExtentPoint32W(
            paintDc, text, static_cast<int>(wcslen(text)), &textSize) &&
        textSize.cx > availableTextWidth && fontHeight > 9) {
      SelectObject(paintDc, previousFont);
      DeleteObject(font);
      fontHeight = std::max(
          9, fontHeight * availableTextWidth / std::max(1L, textSize.cx));
      font = createButtonFont(fontHeight);
      previousFont = SelectObject(paintDc, font);
    }
    SetBkMode(paintDc, TRANSPARENT);
    SetTextColor(paintDc, RGB(232, 237, 244));
    RECT textRect = button;
    DrawTextW(
        paintDc, text, -1, &textRect,
        DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
    SelectObject(paintDc, previousFont);
    DeleteObject(font);'''
if old not in s:
    raise SystemExit('button font block not found')
write(p, s.replace(old, new, 1))

# Update the remaining static tests that intentionally inspect the layout call
# signature. The fourth argument is now the selected-profile monitor flag.
replace_once(
    'hp/video/test/stationhead-background-fullsize-until-playback.test.js',
    r'''  assert.match(startup, /ApplyStationheadChildLayout\([\s\S]*false, false, false\)/);''',
    r'''  assert.match(
    startup,
    /ApplyStationheadChildLayout\([\s\S]*false, false, false,[\s\S]*StationheadMonitorForegroundForProfile\(profileName_\)\)/,
  );''',
    'background startup monitor argument',
)

replace_once(
    'hp/video/test/stationhead-window-optimization-regression.test.js',
    r'''    /ApplyStationheadChildLayout\([\s\S]*false, false, false\)/,''',
    r'''    /ApplyStationheadChildLayout\([\s\S]*false, false, false,[\s\S]*StationheadMonitorForegroundForProfile\(profileName_\)\)/,''',
    'optimization background monitor argument',
)
replace_once(
    'hp/video/test/stationhead-window-optimization-regression.test.js',
    r'''  assert.match(applyLayout, /const bool monitorForeground = StationheadMonitorForeground\(\)/);''',
    r'''  assert.match(applyLayout, /bool monitorForeground/);
  assert.match(layoutSource, /StationheadMonitorForegroundForProfile\(profileName_\)/);''',
    'optimization selected monitor assertion',
)

replace_once(
    'hp/video/test/stationhead-window-regressions.test.js',
    r'''  assert.match(startup, /ApplyStationheadChildLayout\([\s\S]*false, false, false\)/);''',
    r'''  assert.match(
    startup,
    /ApplyStationheadChildLayout\([\s\S]*false, false, false,[\s\S]*StationheadMonitorForegroundForProfile\(profileName_\)\)/,
  );''',
    'window regression startup monitor argument',
)

# Guard against regressions in the longer requested labels.
p = 'hp/video/test/native-power-saving-button-layout.test.js'
s = read(p)
needle = "test('audio output cycles YT and six named Stationhead windows, then OFF', () => {"
insert = '''test('named monitor and audio labels shrink to fit narrow control buttons', () => {
  assert.match(overlay, /GetTextExtentPoint32W/);
  assert.match(overlay, /availableTextWidth/);
  assert.match(overlay, /fontHeight = std::max\([\s\S]*9,/);
});

'''
if insert.strip() not in s:
    at = s.index(needle)
    s = s[:at] + insert + s[at:]
write(p, s)
