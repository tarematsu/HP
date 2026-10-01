export function musicServiceMeta({ label = '集計日', valueId } = {}) {
  return `<div class="music-service-meta">${label} <time${valueId ? ` id="${valueId}"` : ''}>-</time></div>`;
}

export function musicServiceSection({ id = '', kicker = '', title = '', bodyHtml = '' } = {}) {
  return `<section${id ? ` id="${id}"` : ''} class="music-service-section">
    <div class="section-head music-service-section-heading"><div>${kicker ? `<p class="kicker">${kicker}</p>` : ''}<h2>${title}</h2></div></div>
    ${bodyHtml}
  </section>`;
}
