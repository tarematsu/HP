from pathlib import Path

src = Path('hp/native/src/renderer_panels.cpp')
text = src.read_text(encoding='utf-8')
old = '''  const isCurrentSeriesEpisodeLink = link => {\n    if (!link || !link.href) return false;\n    const recommendationHeading = Array.from(document.querySelectorAll(\n        'h1, h2, h3, h4, h5, h6, [role="heading"]')).find(element =>\n          normalize(element.textContent) === 'あなたにおすすめ');\n    if (!recommendationHeading) return true;\n    return Boolean(link.compareDocumentPosition(recommendationHeading) &\n        Node.DOCUMENT_POSITION_FOLLOWING);\n  };\n\n  const openPreferredEpisode = () => {\n    const seriesPath = location.pathname;\n    rememberSeriesPath(seriesPath);\n    const links = Array.from(document.querySelectorAll('a[href*="/episodes/"]'))\n        .filter(isCurrentSeriesEpisodeLink);\n    const hrefs = Array.from(new Set(\n        links.map(link => normalizeEpisodeHref(link.href)).filter(Boolean)));\n    if (!hrefs.length) return;\n    writeEpisodeQueue(seriesPath, hrefs, 0);\n    location.replace(hrefs[0]);\n  };\n'''
new = '''  const findSeriesEpisodeContainer = () => {\n    const headingSelector = 'h1, h2, h3, h4, h5, h6, [role="heading"]';\n    const headings = Array.from(document.querySelectorAll(headingSelector));\n    const episodeHeading = headings.find(element =>\n      /^(?:配信中の)?エピソード(?:一覧)?(?:\\s*\\(\\d+\\)|\\s*\\d+件)?$/.test(\n          normalize(element.textContent)));\n    if (!episodeHeading) return null;\n\n    const foreignSectionHeading =\n        /^(?:あなたにおすすめ|おすすめ|関連番組|関連動画|ランキング)$/;\n    let container = episodeHeading.parentElement;\n    while (container && container !== document.body) {\n      const links = Array.from(\n          container.querySelectorAll('a[href*="/episodes/"]')).filter(\n            link => link.href);\n      if (links.length) {\n        const hasForeignSection = Array.from(\n            container.querySelectorAll(headingSelector)).some(element =>\n              element !== episodeHeading &&\n              foreignSectionHeading.test(normalize(element.textContent)));\n        if (!hasForeignSection) return container;\n      }\n      container = container.parentElement;\n    }\n    return null;\n  };\n\n  const openPreferredEpisode = () => {\n    const seriesPath = location.pathname;\n    rememberSeriesPath(seriesPath);\n    const container = findSeriesEpisodeContainer();\n    if (!container) return;\n    const links = Array.from(\n        container.querySelectorAll('a[href*="/episodes/"]')).filter(\n          link => link.href);\n    const hrefs = Array.from(new Set(\n        links.map(link => normalizeEpisodeHref(link.href)).filter(Boolean)));\n    if (!hrefs.length) return;\n    writeEpisodeQueue(seriesPath, hrefs, 0);\n    location.replace(hrefs[0]);\n  };\n'''
if old not in text:
    raise SystemExit('renderer target snippet not found')
text = text.replace(old, new, 1)
src.write_text(text, encoding='utf-8')

for path in [
    Path('hp/video/test/native-tver-all-episodes-contract.test.js'),
    Path('hp/video/test/native-media-30-90-tver-alternation-contract.test.js'),
]:
    t = path.read_text(encoding='utf-8')
    t = t.replace("  assert.match(composition, /const isCurrentSeriesEpisodeLink = link =>/);\n", '')
    t = t.replace("  assert.match(composition, /normalize\\(element\\.textContent\\) === 'あなたにおすすめ'/);\n", '')
    t = t.replace("  assert.match(composition, /link\\.compareDocumentPosition\\(recommendationHeading\\)/);\n", '')
    t = t.replace("  assert.match(composition, /Node\\.DOCUMENT_POSITION_FOLLOWING/);\n", '')
    t = t.replace("  assert.match(composition, /\\.filter\\(isCurrentSeriesEpisodeLink\\)/);\n", '')
    marker = "  assert.doesNotMatch(composition, /isMainEpisodeLink/);\n"
    addition = """  assert.match(composition, /const findSeriesEpisodeContainer = \\(\\) =>/);\n  assert.match(composition, /if \\(!episodeHeading\\) return null/);\n  assert.match(composition, /あなたにおすすめ\\|おすすめ\\|関連番組\\|関連動画\\|ランキング/);\n  assert.match(composition, /if \\(!container\\) return/);\n  assert.match(composition, /container\\.querySelectorAll\\('a\\[href\\*=\\\"\\/episodes\\/\\\"\\]'\\)/);\n  assert.doesNotMatch(composition, /if \\(!recommendationHeading\\) return true/);\n"""
    if addition not in t:
        if marker not in t:
            raise SystemExit(f'test marker not found: {path}')
        t = t.replace(marker, marker + addition, 1)
    path.write_text(t, encoding='utf-8')
