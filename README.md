# TTS-SRT-KH · SRT Smart Voice Studio

បម្លែងអត្ថបទខ្មែរ ឬ SRT ទៅជា MP3 ដោយប្រើ Microsoft Edge TTS សំឡេង **Piseth** និង **Sreymom**។ អាចកំណត់ល្បឿន និង pitch សម្រាប់សំឡេងគោល ឬសម្រាប់ tag នីមួយៗ។

```text
សួស្តី! <sreymom speed="1.2" pitch="-1">តើអ្នកសុខសប្បាយទេ?</sreymom>
```

Cloudflare Worker បម្រើទាំងគេហទំព័រ និង API ដោយផ្ទាល់; មិនត្រូវការ Python server ឬ FFmpeg សម្រាប់ Worker ទេ។ ក៏អាចដំណើរការជា FastAPI ដោយឡែកបានដែរ។

## Run locally: Cloudflare Worker

ត្រូវការ Node.js **22+** និង npm។

```bash
npm ci
npm run dev
# Open http://localhost:8787
```

Worker ត្រូវការការតភ្ជាប់ទៅសេវា Edge TTS របស់ Microsoft ដើម្បីផលិតសំឡេង។ Static UI អាចបើកបាន ទោះជាការតភ្ជាប់នោះមិនមានក៏ដោយ។

## Deploy to Cloudflare Workers

1. បង្កើត/បើក Workers និង `workers.dev` subdomain ក្នុង Cloudflare account។
2. ពី repository នេះ៖

   ```bash
   npm ci
   npx wrangler login
   npm run deploy
   ```

3. បើក `*.workers.dev` URL ដែល Wrangler បង្ហាញ។ ឈ្មោះ Worker លំនាំដើមគឺ `tts-srt-kh` ក្នុង `wrangler.toml`។ Worker មិនត្រូវការ TTS API key ឬ Python backend ទេ។

### GitHub Actions: PR preview និង production

កំណត់ **repository Actions secrets** ក្នុង GitHub → Settings → Secrets and variables → Actions៖

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token ដែលមាន Account **Workers Scripts: Edit** សម្រាប់ account នោះ (និង **Account Settings: Read** ប្រសិនបើ Wrangler ត្រូវការរក account)។
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID។

Workflow `.github/workflows/cloudflare-worker.yml` ធ្វើដូចខាងក្រោម៖

- PR ទៅ `main`: ដំណើរការ tests និង `wrangler deploy --dry-run`។ ប្រសិនបើ PR មកពី repository ដូចគ្នា និង secrets មានរួច វា deploy preview ដាច់ដោយឡែកជា `tts-srt-kh-pr-<number>` ហើយបង្ហាញ URL ក្នុង Actions job summary។ បើគ្មាន secrets វារំលង preview។
- PR ពី fork និង Dependabot: test/dry-run ប៉ុណ្ណោះ មិនប្រើ deployment secrets។
- ពេលបិទ PR: លុប preview Worker ប្រសិនបើមាន (មិនបង្ខំលុបបើ Worker ផ្សេងពឹងផ្អែកលើវា)។
- Push/merge ទៅ `main` ឬ **Run workflow** លើ `main`: test រួច deploy production Worker។ Production job នឹងបង្ហាញ error ប្រសិនបើ secrets មិនទាន់កំណត់។

ប្រសិនបើប្តូរឈ្មោះ `tts-srt-kh` ក្នុង Wrangler សូមកែ prefix preview ក្នុង workflow ផងដែរ។ CI និង direct `wrangler deploy` គឺជាជម្រើសពីរ; ជៀសវាងការកំណត់ deployment automation ផ្សេងមកកាន់ Worker ឈ្មោះដូចគ្នា។

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

- `voiceName`: `piseth` ឬ `sreymom` (`visal` និង `mina` ជា aliases); `speed`: 0.5–2.0; `pitch`: integer -10–10។
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
