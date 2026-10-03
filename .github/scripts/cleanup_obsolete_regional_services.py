from pathlib import Path
import re
import subprocess

REMOVED = [
    'genie','bugs','joox','nhaccuatui','anghami','melon','netease_cloud_music','naver_vibe','flo',
    'yandex_music','boomplay','plern','fungjai','zing_mp3','jiosaavn','gaana','langit_musik',
]
FILE_TOKENS = [
    'genie','bugs','joox','nhaccuatui','anghami','melon','netease','vibe','flo',
    'yandex','boomplay','plern','fungjai','zing','jiosaavn','gaana','langit',
]
ACTIVE = {'youtube_music','kkbox','qq_music','kugou_music'}
assert not ACTIVE.intersection(REMOVED)


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def remove_function(text, name):
    marker = f'function {name}('
    while marker in text:
        start = text.index(marker)
        line_start = text.rfind('\n', 0, start) + 1
        brace = text.index('{', start)
        depth = 0
        quote = None
        escape = False
        i = brace
        while i < len(text):
            c = text[i]
            if quote:
                if escape:
                    escape = False
                elif c == '\\':
                    escape = True
                elif c == quote:
                    quote = None
            else:
                if c in "'\"`":
                    quote = c
                elif c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        if end < len(text) and text[end] == '\n':
                            end += 1
                        text = text[:line_start] + text[end:]
                        break
            i += 1
        else:
            raise RuntimeError(f'unclosed function: {name}')
    return text


def remove_const_template(text, name):
    marker = f'const {name} = '
    if marker not in text:
        return text
    start = text.index(marker)
    line_start = text.rfind('\n', 0, start) + 1
    end = text.find('\n});', start)
    if end == -1:
        raise RuntimeError(f'cannot remove const: {name}')
    end += len('\n});')
    if end < len(text) and text[end] == '\n':
        end += 1
    return text[:line_start] + text[end:]


# Registry: keep only YouTube Music + currently retained regional providers.
p = 'worker/src/regional-music-service-registry.js'
text = read(p)
for service in REMOVED:
    text = re.sub(rf"^  {re.escape(service)}: Object\.freeze\([^\n]+\),\n", '', text, flags=re.M)
write(p, text)

# Collector registry: drop retired provider imports and dispatch entries.
p = 'worker/src/regional-music-entry.js'
text = read(p)
for token in FILE_TOKENS:
    text = re.sub(rf"^import .* from './regional-music-{re.escape(token)}\.js';\n", '', text, flags=re.M)
for service in REMOVED:
    text = re.sub(rf"^  {re.escape(service)}: [^,]+,\n", '', text, flags=re.M)
write(p, text)

# Scheduling: Monday 00:00 JST = KKBOX; QQ and Kugou retain dedicated schedules.
write('worker/src/regional-music-dispatch-plan.js', """export const REGIONAL_MUSIC_DAILY_SERVICES = Object.freeze([\n  'kkbox',\n  'qq_music',\n  'kugou_music',\n]);\n\nexport const REGIONAL_MUSIC_DISPATCH_UTC_HOUR = 15; // 00:00 JST; Actions owns the Monday standard collection run.\nexport const REGIONAL_MUSIC_EVERY_DAY = Object.freeze([]);\nexport const REGIONAL_MUSIC_WEEKLY_SERVICES = Object.freeze(['kkbox']);\nexport const QQ_MUSIC_WEEKLY_JST_DAY = 4;\nexport const QQ_MUSIC_WEEKLY_JST_HOUR = 18;\nexport const KUGOU_MUSIC_WEEKDAY_JST_HOUR = 11;\n\nexport function regionalMusicR2DueServices(timestamp) {\n  const date = new Date(Number(timestamp) + 9 * 60 * 60 * 1000);\n  if (!Number.isFinite(date.getTime())) throw new Error('Invalid regional collection timestamp');\n  const jstDay = date.getUTCDay();\n  const jstHour = date.getUTCHours();\n\n  if (jstDay === QQ_MUSIC_WEEKLY_JST_DAY && jstHour === QQ_MUSIC_WEEKLY_JST_HOUR) return ['qq_music'];\n  if (jstDay >= 1 && jstDay <= 5 && jstHour === KUGOU_MUSIC_WEEKDAY_JST_HOUR) return ['kugou_music'];\n  if (jstHour !== 0) return [];\n  return jstDay === 1 ? [...REGIONAL_MUSIC_WEEKLY_SERVICES] : [...REGIONAL_MUSIC_EVERY_DAY];\n}\n\nexport function regionalMusicDispatchForTimestamp(timestamp) {\n  return null;\n}\n\nexport async function enqueueRegionalMusicDispatch(env, timestamp) {\n  const message = regionalMusicDispatchForTimestamp(timestamp);\n  if (!message) return null;\n  if (!env?.REGIONAL_MUSIC_QUEUE?.send) throw new Error('REGIONAL_MUSIC_QUEUE binding is missing');\n  await env.REGIONAL_MUSIC_QUEUE.send(message);\n  return message;\n}\n""")

# Common R2 Actions collector: remove Genie/NetEase special paths while preserving KKBOX handling.
p = 'worker/scripts/collect-regional-r2-actions.mjs'
text = read(p)
text = re.sub(r"^import \{ enqueueGeniePublication \} from './collect-genie-r2-actions\.mjs';\n", '', text, flags=re.M)
text = re.sub(r"^import \{ collectGenieSnapshot \} from '../src/genie-catalog-snapshot\.js';\n", '', text, flags=re.M)
text = re.sub(r"^import \{\n  neteaseJapanHistoryRecordFromSnapshot,\n  upsertNeteaseJapanHistoryArtifacts,\n\} from '../src/netease-japan-chart-history\.js';\n", '', text, flags=re.M)
text = text.replace("  // Small services finish before the large Genie catalog. An interrupted Genie\n  // run does not discard the already persisted snapshots of other providers.\n  for(const service of services.filter(value=>value!=='genie')) {", "  for(const service of services) {")
text = re.sub(r"\n      let neteaseHistoryChanged=false;\n      if\(service==='netease_cloud_music'[\s\S]*?\n      }\n      let kkboxHistoryChanged=false;", "\n      let kkboxHistoryChanged=false;", text, count=1)
text = text.replace("        ...(service==='netease_cloud_music' ? {japan_chart_history_changed:neteaseHistoryChanged} : {}),\n", '')
text = re.sub(r"\n  if\(services\.includes\('genie'\)\) \{[\s\S]*?\n  }\n  return results;", "\n  return results;", text, count=1)
insert = """\nasync function enqueueRegionalPublication(config, api, now) {\n  const name=config.queues?.consumers?.[0]?.queue;\n  if(!name) throw new Error('Regional publication queue missing');\n  const queues=await api('/queues');\n  const queue=queues.find(row=>row.queue_name===name);\n  if(!queue?.queue_id) throw new Error('Regional publication queue not found');\n  await api(`/queues/${queue.queue_id}/messages`,{body:{message_type:'regional-music-publish',scheduled_at:now},content_type:'json'});\n}\n"""
text = text.replace("const REGIONAL_SERVICE_SET=new Set(REGIONAL_MUSIC_DAILY_SERVICES);\n", "const REGIONAL_SERVICE_SET=new Set(REGIONAL_MUSIC_DAILY_SERVICES);\n" + insert)
text = text.replace('await enqueueGeniePublication(config,api,Date.now());', 'await enqueueRegionalPublication(config,api,Date.now());')
write(p, text)

# Read model: remove NetEase/Melon-specific history payloads.
p = 'worker/src/regional-music-read-model.js'
text = read(p)
text = re.sub(r"^import \{ NETEASE_JAPAN_HISTORY_VIEW_KEY \} from './netease-japan-chart-history\.js';\n", '', text, flags=re.M)
text = re.sub(r"^import \{ MELON_JPOP_HISTORY_VIEW_KEY \} from './melon-jpop-history\.js';\n", '', text, flags=re.M)
text = text.replace('neteaseJapanChartReadModel', 'regionalChartHistoryReadModel')
text = remove_function(text, 'melonJpopChartReadModel')
text = re.sub(r"^  if \(serviceId === 'netease_cloud_music'\).*\n", '', text, flags=re.M)
text = re.sub(r"^  if \(serviceId === 'melon'\).*\n", '', text, flags=re.M)
text = re.sub(r"^    netease_japan_chart:.*\n", '', text, flags=re.M)
text = re.sub(r"^    melon_jpop_chart:.*\n", '', text, flags=re.M)
text = re.sub(r"  } else if \(serviceId === 'netease_cloud_music'\) \{[\s\S]*?(?=  } else if \(serviceId ===)", '', text)
text = re.sub(r"  } else if \(serviceId === 'melon'\) \{[\s\S]*?(?=  } else if \(serviceId ===)", '', text)
text = re.sub(r"^\s*const neteaseJapanChart.*\n", '', text, flags=re.M)
text = re.sub(r"^\s*const melonJpopChart.*\n", '', text, flags=re.M)
text = re.sub(r"^\s*neteaseJapanChart,?\n", '', text, flags=re.M)
text = re.sub(r"^\s*melonJpopChart,?\n", '', text, flags=re.M)
write(p, text)

# Public API allow-list and contract version.
p = 'site/functions/lib/api-contract.js'
text = read(p)
match = re.search(r'export const API_CONTRACT_VERSION = (\d+);', text)
if not match:
    raise RuntimeError('API_CONTRACT_VERSION not found')
text = text[:match.start(1)] + str(int(match.group(1)) + 1) + text[match.end(1):]
for service in REMOVED:
    text = re.sub(rf"^\s*'{re.escape(service)}',\n", '', text, flags=re.M)
write(p, text)

# Generic regional UI labels and Melon-only rendering.
p = 'site/public/regional-music.js'
text = read(p)
for service in REMOVED:
    text = re.sub(rf"^  {re.escape(service)}: '[^']*',\n", '', text, flags=re.M)
text = re.sub(r"^let melonArtistFilter.*\n", '', text, flags=re.M)
text = re.sub(r"^let lastMelonPayload.*\n", '', text, flags=re.M)
text = text.replace("return service === 'melon' || service === 'qq_music' || service === 'kugou_music';", "return service === 'qq_music' || service === 'kugou_music';")
for name in ['melonArtistVisible','syncMelonFilterButtons','bindMelonFilters','renderMelonPopularity','resetMelonSection']:
    text = remove_function(text, name)
text = re.sub(r"^\s*renderMelonPopularity\([^\n]*\);\n", '', text, flags=re.M)
text = re.sub(r"^\s*resetMelonSection\(\);\n", '', text, flags=re.M)
write(p, text)

# Shells: remove Melon and NetEase special sections/routes.
p = 'site/public/regional-music-shell.js'
text = read(p)
for name in ['melonPopularityTable','melonPopularitySection']:
    text = remove_const_template(text, name)
text = text.replace('      ${melonPopularitySection}\n', '')
text = re.sub(r"^void import\('./netease-japan-chart-ui\.js[^\n]*\n", '', text, flags=re.M)
write(p, text)

p = 'site/public/music-service-shell.js'
text = read(p)
text = text.replace("const REGIONAL_SPECIAL_SERVICES = new Set(['melon', 'qq_music', 'kugou_music', 'netease_cloud_music']);", "const REGIONAL_SPECIAL_SERVICES = new Set(['qq_music', 'kugou_music']);")
text = re.sub(r"^  netease_cloud_music: '[^']+',\n", '', text, flags=re.M)
text = re.sub(r"^  melon: '[^']+',\n", '', text, flags=re.M)
write(p, text)

# Remove Genie navigation/runtime bootstrap.
p = 'site/public/index.html'
text = re.sub(r'^\s*<button[^\n]+data-source="genie"[^\n]*\n', '', read(p), flags=re.M)
write(p, text)
p = 'site/public/dashboard-metrics.js'
text = re.sub(r"^import './genie-catalog-ui\.js[^\n]*\n", '', read(p), flags=re.M)
write(p, text)

# Provider-specific implementation, probes, docs, UI assets and tests.
# Workflow files are intentionally handled outside this generated commit because
# the GitHub Actions token cannot push workflow changes.
roots = (
    'worker/src/','worker/scripts/','worker/tests/','site/public/','site/styles/','site/tests/',
    'tests/','.github/scripts/','docs/','research/'
)
segment = re.compile(r'(?:^|[-_.])(' + '|'.join(map(re.escape, FILE_TOKENS)) + r')(?:[-_.]|$)', re.I)
for path in subprocess.check_output(['git','ls-files'], text=True).splitlines():
    if path in {'.github/scripts/cleanup_obsolete_regional_services.py', '.github/scripts/purge_obsolete_regional_music_r2.mjs'}:
        continue
    if path.startswith(roots) and segment.search(Path(path).name):
        Path(path).unlink(missing_ok=True)

# Remove stylesheet/import references whose target files were removed.
for path in ['site/styles/index.css','site/styles.css','site/public/index.html','site/public/dashboard-metrics.js']:
    file = Path(path)
    if not file.exists():
        continue
    text = file.read_text(encoding='utf-8')
    text = re.sub(r"^.*(?:genie|melon|netease)[-_][^\n]*\.(?:css|js)[^\n]*\n", '', text, flags=re.I|re.M)
    file.write_text(text, encoding='utf-8')

# Permanent, idempotent D1 purge migration. Historical migrations stay untouched.
removed_sql = ','.join(f"'{service}'" for service in REMOVED)
write('database/other-migrations/069_remove_obsolete_regional_music_services.sql', f"""-- Retire regional providers that are no longer collected or exposed.\nDELETE FROM regional_music_playlist_memberships WHERE service IN ({removed_sql});\nDELETE FROM regional_music_playlist_snapshots WHERE service IN ({removed_sql});\nDELETE FROM regional_music_playlists WHERE service IN ({removed_sql});\nDELETE FROM regional_music_artist_track_order WHERE service IN ({removed_sql});\nDELETE FROM regional_music_track_daily WHERE service IN ({removed_sql});\nDELETE FROM regional_music_tracks WHERE service IN ({removed_sql});\nDELETE FROM regional_music_releases WHERE service IN ({removed_sql});\nDELETE FROM regional_music_artist_daily WHERE service IN ({removed_sql});\nDELETE FROM regional_music_artist_profiles WHERE service IN ({removed_sql});\nDELETE FROM regional_music_collector_state WHERE service IN ({removed_sql});\n""")

# Syntax smoke checks before committing.
for path in [
    'worker/src/regional-music-service-registry.js',
    'worker/src/regional-music-entry.js',
    'worker/src/regional-music-dispatch-plan.js',
    'worker/src/regional-music-read-model.js',
    'worker/scripts/collect-regional-r2-actions.mjs',
    'site/functions/lib/api-contract.js',
    'site/public/regional-music.js',
    'site/public/regional-music-shell.js',
    'site/public/music-service-shell.js',
]:
    subprocess.run(['node','--check',path], check=True)

print('obsolete regional service cleanup edit complete')
