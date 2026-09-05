from pathlib import Path

src = Path('hp/native/src/renderer_panels.cpp')
text = src.read_text(encoding='utf-8')
old = '''  const openPreferredEpisode = () => {\n    const seriesPath = location.pathname;\n    rememberSeriesPath(seriesPath);\n    const links = Array.from(document.querySelectorAll('a[href*=\"/episodes/\"]'))\n        .filter(link => link.href);\n    const hrefs = Array.from(new Set(\n        links.map(link => normalizeEpisodeHref(link.href)).filter(Boolean)));\n    if (!hrefs.length) return;\n    writeEpisodeQueue(seriesPath, hrefs, 0);\n    location.replace(hrefs[0]);\n  };\n'''
new = '''  const isCurrentSeriesEpisodeLink = link => {\n    if (!link || !link.href) return false;\n    const recommendationHeading = Array.from(document.querySelectorAll(\n        'h1, h2, h3, h4, h5, h6, [role=\"heading\"]')).find(element =>\n          normalize(element.textContent) === 'あなたにおすすめ');\n    if (!recommendationHeading) return true;\n    return Boolean(link.compareDocumentPosition(recommendationHeading) &\n        Node.DOCUMENT_POSITION_FOLLOWING);\n  };\n\n  const openPreferredEpisode = () => {\n    const seriesPath = location.pathname;\n    rememberSeriesPath(seriesPath);\n    const links = Array.from(document.querySelectorAll('a[href*=\"/episodes/\"]'))\n        .filter(isCurrentSeriesEpisodeLink);\n    const hrefs = Array.from(new Set(\n        links.map(link => normalizeEpisodeHref(link.href)).filter(Boolean)));\n    if (!hrefs.length) return;\n    writeEpisodeQueue(seriesPath, hrefs, 0);\n    location.replace(hrefs[0]);\n  };\n'''
if old not in text:
    raise SystemExit('renderer snippet not found')
text = text.replace(old, new, 1)
src.write_text(text, encoding='utf-8')

test = Path('hp/video/test/native-tver-all-episodes-contract.test.js')
t = test.read_text(encoding='utf-8')
old_filter = "  assert.match(composition, /\\.filter\\(link => link\\.href\\)/);\n"
if old_filter not in t:
    raise SystemExit('obsolete href-only assertion not found')
t = t.replace(old_filter, '', 1)
old_t = "  assert.match(composition, /Array\\.from\\(new Set\\(/);\n"
new_t = """  assert.match(composition, /const isCurrentSeriesEpisodeLink = link =>/);\n  assert.match(composition, /normalize\\(element\\.textContent\\) === 'あなたにおすすめ'/);\n  assert.match(composition, /link\\.compareDocumentPosition\\(recommendationHeading\\)/);\n  assert.match(composition, /Node\\.DOCUMENT_POSITION_FOLLOWING/);\n  assert.match(composition, /\\.filter\\(isCurrentSeriesEpisodeLink\\)/);\n  assert.match(composition, /Array\\.from\\(new Set\\(/);\n"""
if old_t not in t:
    raise SystemExit('test insertion point not found')
t = t.replace(old_t, new_t, 1)
test.write_text(t, encoding='utf-8')
