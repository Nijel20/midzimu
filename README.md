# Midzimu — Echoes of the Ancestors

An offline-first family oral-history archive for preserving memories, proverbs, traditional practices, recipes, and the words elders choose to share.

## What works

- Write and edit stories, then search or filter the archive.
- Record audio in the browser or attach an existing audio file; recordings and transcripts are kept together on this device.
- Save and restore a JSON backup, including audio recordings.
- Install the app as a progressive web app and reopen its interface offline after the first visit.
- Optionally ask a local Ollama model to draft a summary, suggest themes, or translate a transcript. The original transcript stays untouched.

There are no accounts, analytics, cloud storage, external AI APIs, or third-party runtime dependencies. The archive is stored in this browser's IndexedDB. Clearing browser data can erase it, so make a backup somewhere you control.

## Run locally

Requires Python 3; the app itself has no package installation step. From this directory:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The app shell is cached for offline visits. Microphone recording and local storage require a supported browser and a secure context; `localhost` qualifies.

## Optional: connect a local model

Install [Ollama](https://ollama.com/) and download an open-weight model. For example:

```powershell
ollama pull gemma3:1b
```

Ollama must allow requests from the app's local origin. If Ollama is started from the same PowerShell session, configure its allowed origins and start it there:

```powershell
$env:OLLAMA_ORIGINS = "http://127.0.0.1:4173"
ollama serve
```

If Ollama is already running as a background service, restart it after setting `OLLAMA_ORIGINS`. Open a story, expand **Local AI story helper**, enter the model name you installed, and choose a target language if you want a translation. The browser sends the transcript only to the Ollama address you enter; a remote address is not private.

Local models need memory and disk space, and the first response can be slow while a model loads. Translation quality varies by model and language, especially for less-resourced languages and idioms. Have a fluent speaker check translations; AI suggestions are not authoritative cultural interpretation.

## Care and consent

Ask before recording or sharing someone's story. Preserve the teller's own words and context, make edits transparent, and confirm translations with a fluent speaker. Keep backups private: they contain the archive and any recordings.

## Challenge

Built for the DEV Hacktoberfest Open-Source AI Challenge: Week 4, **Ghost in the Machine**. Its open-based approach is intentionally local: the archive works without AI, and optional AI processing goes to a model running on the user's own machine.
