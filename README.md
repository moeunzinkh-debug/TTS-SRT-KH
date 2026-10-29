# TTS-SRT-KH · SRT Smart Voice Studio

បម្លែងអត្ថបទខ្មែរ ឬ SRT ទៅជា MP3 ដោយប្រើ Microsoft Edge TTS សំឡេង **Piseth** និង **Sreymom**។ អាចកំណត់ល្បឿន និង pitch សម្រាប់សំឡេងគោល ឬសម្រាប់ tag នីមួយៗ។

```text
សួស្តី! <sreymom speed="1.2" pitch="-1">តើអ្នកសុខសប្បាយទេ?</sreymom>
```

Cloudflare Worker បម្រើទាំងគេហទំព័រ និង API ដោយផ្ទាល់; មិនត្រូវការ Python server ឬ FFmpeg សម្រាប់ Worker ទេ។ ក៏អាចដំណើរការជា FastAPI ដោយឡែកបានដែរ។

ចុច **Upload SRT/TXT** ជិតប៊ូតុង **Clear** ដើម្បីបើកឯកសារ `.srt` ឬ `.txt` ក្នុង editor។ ឯកសារត្រូវអានក្នុង browser (UTF-8 ឬ UTF-16 ដែលមាន BOM, អតិបរមា 5 MB) ហើយនឹងស្នើការបញ្ជាក់មុនជំនួសអត្ថបទដែលមានស្រាប់។ អត្ថបទត្រូវផ្ញើសម្រាប់ TTS តែពេលចុច Generate ប៉ុណ្ណោះ។ ការផលិតសំឡេងម្តងមានកំណត់ 20,000 characters ដូច្នេះអាចត្រូវបំបែកអត្ថបទពីឯកសារធំៗ។

នៅមុខជួរអត្ថបទនីមួយៗ ចុច **♂** សម្រាប់ Piseth ឬ **♀** សម្រាប់ Sreymom។ ជម្រើសនេះប្រើល្បឿន/pitch របស់សំឡេងគោល ហើយគ្របដណ្ដប់អត្ថបទទាំងជួរ; ជួរដែលមិនបានជ្រើសប្រើសំឡេងគោល ឬ voice tags ដូចដើម។ ចុចប៊ូតុងដែលបានជ្រើសម្ដងទៀតដើម្បីដកជម្រើស ឬចុច **ដកសំឡេងប្រុស/ស្រីគ្រប់ជួរ** ដើម្បីដកតែជម្រើសសំឡេង។

ចុច **⚙️ នៅចុងជួរ** ដើម្បីកំណត់ **Speed (0.5–2.0x)** និង **Pitch (-10–10)** សម្រាប់ជួរនោះ រួចចុច **រក្សាទុក**។ ពេលបើកលើកដំបូង វាបង្ហាញតម្លៃដែលទទួលពីអត្ថបទនិយាយដំបូងក្នុងជួរ។ ជម្រើសនេះរក្សាសំឡេងប្រុស/ស្រី ឬ voice tag ដដែល ប៉ុន្តែគ្របដណ្ដប់ល្បឿន/pitch របស់សំឡេងគោល ឬ tag ទាំងជួរ និងមានអាទិភាពលើ **Auto Speed** សូម្បីកំណត់ត្រឹម 1.0x។ ចុច ⚙️ ម្តងទៀត ហើយជ្រើស **ប្រើល្បឿន និង pitch គោល ឬ Tag** ដើម្បីដកការកំណត់ជួរនោះ; **បោះបង់** មិនរក្សាទុកការកែប្រែ។

លេខ ម៉ោង SRT ជួរទទេ និងជួរដែលមានតែ tag មិនមានប៊ូតុងទេ។ ជម្រើសសំឡេង និង ⚙️ តាមជួររក្សានៅក្នុង editor បច្ចុប្បន្នប៉ុណ្ណោះ មិនកែឯកសារដើម និងមិនរក្សាទុកក្រោយ reload ទេ។ ការបំបែកជួរចម្លងជម្រើសទៅជួរទាំងពីរ; ការភ្ជាប់ជួររក្សាជម្រើសរបស់ជួរដំបូង។ Clear ឬ upload ឯកសារដែលមានអត្ថបទខុសពីបច្ចុប្បន្នលុបជម្រើសទាំងនេះ។

## Run locally: Cloudflare Worker

ត្រូវការ Node.js **22+** និង npm។

```bash
npm ci
npm run dev
# Open http://localhost:8787
```

Worker ត្រូវការការតភ្ជាប់ទៅសេវា Edge TTS របស់ Microsoft ដើម្បីផលិតសំឡេង។ Static UI អាចបើកបាន ទោះជាការតភ្ជាប់នោះមិនមានក៏ដោយ។

## Deploy from the Cloudflare dashboard (Workers Builds)

Cloudflare ដំណើរការ build និង deploy ដោយផ្ទាល់។ GitHub គ្រាន់តែជាប្រភព repository ប៉ុណ្ណោះ; **មិនប្រើ GitHub Actions ឬ GitHub deployment secrets** ទេ។

1. ក្នុង Cloudflare Dashboard បើក **Workers & Pages** → **Create application** → **GitHub** ហើយជ្រើស repository នេះ។ សម្រាប់ Worker ដែលមានរួច៖ បើក Worker → **Settings** → **Builds** → **Connect**។ បង្កើត `workers.dev` subdomain ប្រសិនបើមិនទាន់មាន។
2. កំណត់ Workers Builds ដូចខាងក្រោម៖

   | Setting | Value |
   | --- | --- |
   | Production branch | `main` |
   | Root directory | `/` (repository root) |
   | Build command | `npm run build` |
   | Deploy command | `npm run deploy` |
   | Preview command | `npx wrangler preview` |

   `.nvmrc` កំណត់ Node.js 22។ Workers Builds ដំឡើង npm dependencies ដោយស្វ័យប្រវត្តិ ហើយ `npm run build` រត់ tests និង Wrangler dry-run មុន deploy។ បើបានបិទ automatic dependency installation (`SKIP_DEPENDENCY_INSTALL=1`), ប្រើ `npm ci && npm run build` ជា build command ជំនួស។
3. ឈ្មោះ Worker លំនាំដើមក្នុង `wrangler.toml` គឺ `tts-srt-kh`។ ប្រសិនបើភ្ជាប់ Worker ដែលមានឈ្មោះផ្សេង សូមកែ `name` ឱ្យត្រូវជាមួយឈ្មោះ Worker ក្នុង Cloudflare មុន deploy។ Worker មិនត្រូវការ TTS API key ឬ Python backend ទេ។
4. ចុច **Save and Deploy** (ឬ trigger/retry build សម្រាប់ Worker ដែលមានរួច)។ មើល build logs ក្នុង **Deployments** → **View build history** ហើយបើក `*.workers.dev` URL។ Cloudflare Workers Builds គ្រប់គ្រង deployment authentication ក្នុង Cloudflare account។

### PR previews

ក្នុង Worker → **Settings** → **Build** → **Branch control**, បើក **Enable Preview Builds**។ Cloudflare នឹងប្រើ preview command សម្រាប់ branch ដែលមិនមែន `main`; មើល Preview URL ក្នុងផ្នែក **Previews** ឬ PR comment ប្រសិនបើ Git integration បានបើក comments។ សម្រាប់ Worker ចាស់ ដែលនៅប្រើ preview model ចាស់ សូមជ្រើស **Set up Worker Previews** ក្នុង Builds settings ជាមុន។

មុន PR នេះត្រូវ merge, `main` មិនទាន់មានការកែប្រែនេះទេ។ ដើម្បីសាកល្បងវាមុន production សូមបើក preview builds សម្រាប់ branch របស់ PR ហើយ push commit ឬ trigger build សម្រាប់ branch នោះ (អាចប្រើ Deploy Hook ក្នុង Cloudflare)។ ក្រោយ merge ទៅ `main` Cloudflare នឹង run production build/deploy។

### Manual deploy with Wrangler (optional)

```bash
npm ci
npx wrangler login
npm run build
npm run deploy
```

ពាក្យបញ្ជាទាំងនេះ run ពីកុំព្យូទ័រដែលអ្នក login Cloudflare រួច មិនមែន GitHub Actions ទេ។

## Optional Python / Docker server

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 7860
# Open http://localhost:7860
```

ឬ៖

```bash
docker build -f Dockerfile.txt -t tts-srt-kh .
docker run --rm -p 7860:7860 tts-srt-kh
```

Python ប្រើ `edge-tts>=7.3.1,<8` ដែលគាំទ្រ Sec-MS-GEC v2; Worker ប្រើ v2 token implementation ពី `node-edge-tts`។ MP3 frames ត្រូវបានភ្ជាប់តាមលំដាប់ក្នុង memory ដោយមិនបង្កើតឯកសារបណ្តោះអាសន្ន និងមិនត្រូវការ FFmpeg។

## API និងកម្រិត

`POST /api/process-multi` ទទួល multipart form fields `data` (JSON array) និង `autoSpeed` (`true`/`false`) ហើយត្រឡប់ `audio/mpeg`។ ឧទាហរណ៍៖

```bash
curl --fail -X POST 'https://YOUR-WORKER.workers.dev/api/process-multi' \
  -F 'data=[{"text":"សួស្តី","voiceName":"piseth","speed":1.0,"pitch":0}]' \
  -F 'autoSpeed=false' -o voice.mp3
```

- `voiceName`: `piseth` ឬ `sreymom` (`visal` និង `mina` ជា aliases); `speed`: 0.5–2.0; `pitch`: integer -10–10។ Optional `autoSpeed` boolean ក្នុង part អាច override `autoSpeed` របស់ request សម្រាប់ part នោះ; requests ចាស់ដែលមិនមាន field នេះប្រើតម្លៃរបស់ request ដូចដើម។
- អតិបរមា 20,000 characters និង 200 voice parts ក្នុង request; បន្ទាប់ពី batch/split មានអតិបរមា 40 Edge TTS requests ដើម្បីសមនឹង Workers free-plan subrequest limits។ Request ធំៗក៏អាចប៉ះ CPU/memory limits របស់ Cloudflare បាន; បំបែកអត្ថបទជាបំណែកតូចៗ ឬប្រើ paid plan ប្រសិនបើចាំបាច់។
- SRT cue numbers និង timestamps ត្រូវបានដកចេញ។ សំឡេងត្រូវបានភ្ជាប់តាមលំដាប់ **មិនបន្ថែមភាពស្ងាត់តាម timestamp** ទេ; Auto Speed គ្រាន់តែជាការប៉ាន់ស្មានតាមប្រវែងអត្ថបទ។
- កំហុស validation ត្រឡប់ 400/413; Microsoft/network error ត្រឡប់ 502 ឬ 504 ជាមួយ JSON `detail`។ មិនត្រឡប់ MP3 ខ្លះៗទេ ប្រសិនបើ segment ណាមួយបរាជ័យ។

អត្ថបទត្រូវបានផ្ញើទៅ Microsoft ដើម្បីសំយោគសំឡេង។ សេវានេះជាអន្តរកម្មមិនផ្លូវការ និងអាចផ្លាស់ប្តូរ ឬកំណត់អត្រាប្រើប្រាស់បាន។ Worker/API គឺ public តាមលំនាំដើម៖ ប្រសិនបើ deploy ជាសាធារណៈ សូមប្រើ Cloudflare Access ឬ rate limiting ដើម្បីការពារការប្រើប្រាស់ហួសកម្រិត។

## Tests

```bash
npm ci
npm test
npm run check:deploy
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Tests ប្រើ fake Edge responses និងអាចរត់ដោយមិនតភ្ជាប់ Microsoft។ ដើម្បីបញ្ជាក់ live synthesis សូមសាកល្បងបង្កើត MP3 ពី deployment ដែលអាចភ្ជាប់ Edge TTS បាន។
