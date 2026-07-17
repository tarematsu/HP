namespace hp {
namespace {

thread_local RECT gDashboardClockCard{};

SidebarSections SplitRearrangedSidebarSections(const RECT& client) {
  const int height = std::max(1L, client.bottom - client.top);
  const int gap = std::max(6, height * 18 / 1000);
  const int available = std::max(4, height - gap * 3);
  const int clockHeight = available * 31 / 100;
  const int weatherHeight = available * 23 / 100;
  const int energyHeight = available * 23 / 100;
  const int airHeight = std::max(1, available - clockHeight - weatherHeight - energyHeight);

  SidebarSections sections;
  int top = client.top;
  sections.clock = RECT{client.left, top, client.right, top + clockHeight};
  top = sections.clock.bottom + gap;
  sections.weather = RECT{client.left, top, client.right, top + weatherHeight};
  top = sections.weather.bottom + gap;
  sections.energy = RECT{client.left, top, client.right, top + energyHeight};
  top = sections.energy.bottom + gap;
  sections.controls = RECT{client.left, top, client.right, top + airHeight};
  gDashboardClockCard = sections.clock;
  return sections;
}

MainSections SplitRearrangedMainSections(const RECT& client) {
  const int height = std::max(1L, client.bottom - client.top);
  const int gap = std::max(6, height * 45 / 1000);
  const int newsHeight = height * 47 / 100;

  MainSections sections;
  sections.news = RECT{client.left, client.bottom - newsHeight, client.right, client.bottom};
  sections.music = RECT{client.left, client.top, client.right,
                        std::max(client.top + 1, sections.news.top - gap)};
  sections.air = RECT{client.right, client.top, client.right + 1, client.top + 1};
  return sections;
}

RECT ClockControlsContent(const RECT& card) {
  const RECT content = CardContentRect(card);
  RECT controls{content.left, content.top + SpanY(content, 58), content.right, content.bottom};
  if (controls.bottom <= controls.top) controls.bottom = controls.top + 1;
  return controls;
}

ControlsRects RearrangedControlsFromContent(const RECT&) {
  return ControlsFromContent(ClockControlsContent(gDashboardClockCard));
}

#define HP_DRAW_CLOCK_WITH_CONTROLS(dc, card) do { \
  DrawClockSection((dc), (card)); \
  DrawControlsSection((dc), ClockControlsContent((card))); \
} while (false)

}  // namespace
}  // namespace hp
